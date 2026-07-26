-- VisaFlow KSA application schema baseline.
-- Source: PostgreSQL 17 schema-only export of Production on 2026-07-22.
-- Scope: application-owned public objects plus VisaFlow policies on storage.objects.
-- Excludes rows, bucket metadata, Supabase-managed auth/storage/realtime schemas,
-- ownership commands, connection details, project identifiers, and secrets.
-- Security policies introduced by later repository migrations are intentionally
-- omitted here so the chronological migration chain remains applicable.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_candidates_to_ai_interview_campaign(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) RETURNS TABLE(requested_count integer, inserted_count integer, duplicate_count integer, valid_count integer, invalid_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_campaign public.ai_interview_campaigns%ROWTYPE;
  v_requested integer := 0;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
BEGIN
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Campaign ID is required.';
  END IF;

  IF p_candidate_ids IS NULL OR cardinality(p_candidate_ids) = 0 THEN
    RAISE EXCEPTION 'At least one candidate ID is required.';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.ai_interview_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI interview campaign % was not found.', p_campaign_id;
  END IF;

  IF v_campaign.status NOT IN ('Draft', 'Ready', 'Paused') THEN
    RAISE EXCEPTION
      'Candidates cannot be added while campaign status is %.',
      v_campaign.status;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND lower(coalesce(u.status, 'Active')) = 'active'
      AND (
        u.company_id = v_campaign.company_id
        OR lower(coalesce(u.role, '')) = 'platform owner'
      )
  ) THEN
    RAISE EXCEPTION 'You do not have access to this campaign.';
  END IF;

  SELECT count(DISTINCT value)::integer
  INTO v_requested
  FROM unnest(p_candidate_ids) AS requested(value)
  WHERE nullif(btrim(value), '') IS NOT NULL;

  INSERT INTO public.ai_interview_campaign_candidates (
    company_id,
    campaign_id,
    candidate_id,
    candidate_name,
    candidate_email,
    candidate_mobile,
    profession,
    nationality,
    agency_name,
    request_no,
    validation_status,
    validation_error,
    status,
    invitation_status,
    analysis_status,
    metadata
  )
  SELECT
    v_campaign.company_id,
    v_campaign.id,
    c.id::text,
    coalesce(c.candidate_name, ''),
    lower(btrim(coalesce(c.email, ''))),
    coalesce(c.mobile, ''),
    coalesce(c.profession, ''),
    coalesce(c.nationality, ''),
    coalesce(c.agency, ''),
    coalesce(c.request_no, ''),
    CASE
      WHEN btrim(coalesce(c.email, '')) = '' THEN 'Invalid'
      WHEN btrim(c.email) !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
        THEN 'Invalid'
      ELSE 'Valid'
    END,
    CASE
      WHEN btrim(coalesce(c.email, '')) = '' THEN 'Candidate email is missing.'
      WHEN btrim(c.email) !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
        THEN 'Candidate email format is invalid.'
      ELSE ''
    END,
    'Pending',
    'Not Queued',
    'Pending',
    jsonb_build_object(
      'source', 'Operational Candidates',
      'added_at', now()
    )
  FROM public.candidates c
  WHERE c.company_id = v_campaign.company_id
    AND c.id::text = ANY(p_candidate_ids)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_duplicates := greatest(v_requested - v_inserted, 0);

  PERFORM public.refresh_ai_interview_campaign_counts(v_campaign.id);

  SELECT
    count(*) FILTER (WHERE validation_status = 'Valid')::integer,
    count(*) FILTER (WHERE validation_status IN ('Invalid', 'Duplicate'))::integer
  INTO v_valid, v_invalid
  FROM public.ai_interview_campaign_candidates
  WHERE campaign_id = v_campaign.id;

  UPDATE public.ai_interview_campaigns
  SET
    status = CASE WHEN v_valid > 0 THEN 'Ready' ELSE 'Draft' END,
    updated_at = now()
  WHERE id = v_campaign.id
    AND status IN ('Draft', 'Ready');

  RETURN QUERY
  SELECT
    v_requested,
    v_inserted,
    v_duplicates,
    v_valid,
    v_invalid;
END;
$_$;


--
-- Name: ai_agent_emergency_stop(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_agent_emergency_stop(p_company_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.ai_agent_settings
  set
    is_active = false,
    mode = 'off',
    auto_manager_approval = false,
    auto_followup_agencies = false,
    allow_auto_agency_emails = false,
    client_auto_enabled = false,
    updated_at = now()
  where company_id = p_company_id;

  update public.ai_agent_jobs
  set status = 'skipped', error_message = 'AI Agent emergency stop', updated_at = now()
  where company_id = p_company_id and status in ('queued', 'running');

  insert into public.ai_agent_audit_logs (
    company_id, action_type, action_key, status, severity, actor, title, details
  ) values (
    p_company_id,
    'AI_AGENT_EMERGENCY_STOP',
    'emergency_stop:' || p_company_id::text || ':' || extract(epoch from now())::text,
    'completed',
    'critical',
    'PLATFORM_OWNER',
    'AI Agent emergency stop executed',
    jsonb_build_object('stopped_at', now())
  );
end;
$$;


--
-- Name: ai_agent_hourly_action_count(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_agent_hourly_action_count(p_company_id uuid, p_actor text DEFAULT 'AI_AGENT_WORKER'::text) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select count(*)::integer
  from public.ai_agent_audit_logs
  where company_id = p_company_id
    and actor = coalesce(p_actor, 'AI_AGENT_WORKER')
    and status in ('completed', 'queued', 'lock_acquired')
    and created_at >= now() - interval '1 hour';
$$;


--
-- Name: ai_agent_release_lock(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_agent_release_lock(p_company_id uuid, p_action_key text, p_status text DEFAULT 'completed'::text, p_error_message text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.ai_agent_action_locks
  set
    status = coalesce(p_status, 'completed'),
    last_error = p_error_message,
    last_executed_at = case when coalesce(p_status, 'completed') = 'completed' then now() else last_executed_at end,
    updated_at = now()
  where company_id = p_company_id and action_key = p_action_key;
end;
$$;


--
-- Name: ai_agent_try_acquire_lock(uuid, text, text, text, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text DEFAULT 'AI_AGENT_ACTION'::text, p_related_table text DEFAULT NULL::text, p_related_id text DEFAULT NULL::text, p_agency_id uuid DEFAULT NULL::uuid, p_cooldown_minutes integer DEFAULT 60) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_acquired boolean;
  v_cooldown integer;
begin
  v_cooldown := greatest(coalesce(p_cooldown_minutes, 60), 5);

  insert into public.ai_agent_action_locks (
    company_id,
    action_key,
    action_type,
    related_table,
    related_id,
    agency_id,
    status,
    attempts,
    locked_until,
    run_id,
    updated_at
  ) values (
    p_company_id,
    p_action_key,
    coalesce(p_action_type, 'AI_AGENT_ACTION'),
    p_related_table,
    p_related_id,
    p_agency_id,
    'running',
    1,
    now() + make_interval(mins => v_cooldown),
    gen_random_uuid(),
    now()
  )
  on conflict (company_id, action_key)
  do update set
    action_type = excluded.action_type,
    related_table = excluded.related_table,
    related_id = excluded.related_id,
    agency_id = excluded.agency_id,
    status = 'running',
    attempts = public.ai_agent_action_locks.attempts + 1,
    locked_until = now() + make_interval(mins => v_cooldown),
    run_id = gen_random_uuid(),
    updated_at = now()
  where
    public.ai_agent_action_locks.locked_until is null
    or public.ai_agent_action_locks.locked_until < now()
    or (
      public.ai_agent_action_locks.status in ('failed', 'completed', 'skipped')
      and coalesce(public.ai_agent_action_locks.last_executed_at, timestamp with time zone '2000-01-01') < now() - make_interval(mins => v_cooldown)
    )
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;


--
-- Name: ai_interview_campaign_apply_delivery_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_interview_campaign_apply_delivery_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.settings is not null then
    new.interaction_mode :=
      coalesce(
        nullif(new.settings ->> 'interaction_mode', ''),
        new.interaction_mode,
        'Recorded'
      );

    new.interview_mode :=
      coalesce(
        nullif(new.settings ->> 'interview_mode', ''),
        new.interview_mode,
        'Voice'
      );

    new.camera_mode :=
      coalesce(
        nullif(new.settings ->> 'camera_mode', ''),
        new.camera_mode,
        'Off'
      );

    new.max_dynamic_follow_ups :=
      coalesce(
        nullif(new.settings ->> 'max_dynamic_follow_ups', '')::integer,
        new.max_dynamic_follow_ups,
        1
      );

    new.live_response_timeout_seconds :=
      coalesce(
        nullif(new.settings ->> 'live_response_timeout_seconds', '')::integer,
        new.live_response_timeout_seconds,
        60
      );
  end if;

  return new;
end;
$$;


--
-- Name: ai_interview_campaign_candidate_sync_session_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.session_id is null
     or new.campaign_id is null then
    return new;
  end if;

  -- Prevent a cycle when the session trigger writes the same
  -- session_id and campaign_id back to the candidate row.
  if tg_op = 'UPDATE'
     and old.session_id is not distinct from new.session_id
     and old.campaign_id is not distinct from new.campaign_id then
    return new;
  end if;

  perform public.ai_interview_sync_linked_session_delivery(
    new.session_id,
    new.campaign_id
  );

  return new;
end;
$$;


--
-- Name: ai_interview_campaign_sync_delivery_to_sessions_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if old.interaction_mode is not distinct from new.interaction_mode
     and old.interview_mode is not distinct from new.interview_mode
     and old.camera_mode is not distinct from new.camera_mode
     and old.max_dynamic_follow_ups
         is not distinct from new.max_dynamic_follow_ups
     and old.live_response_timeout_seconds
         is not distinct from new.live_response_timeout_seconds then
    return new;
  end if;

  update public.ai_interview_sessions s
  set
    interaction_mode =
      coalesce(nullif(new.interaction_mode, ''), 'Recorded'),

    interview_mode =
      coalesce(nullif(new.interview_mode, ''), 'Voice'),

    camera_mode =
      coalesce(nullif(new.camera_mode, ''), 'Off'),

    max_dynamic_follow_ups =
      greatest(
        0,
        least(coalesce(new.max_dynamic_follow_ups, 1), 10)
      ),

    live_response_timeout_seconds =
      greatest(
        15,
        least(
          coalesce(new.live_response_timeout_seconds, 60),
          600
        )
      ),

    updated_at = now()
  where s.campaign_id = new.id
    and s.company_id = new.company_id
    and (
      s.interaction_mode is distinct from
        coalesce(nullif(new.interaction_mode, ''), 'Recorded')

      or s.interview_mode is distinct from
        coalesce(nullif(new.interview_mode, ''), 'Voice')

      or s.camera_mode is distinct from
        coalesce(nullif(new.camera_mode, ''), 'Off')

      or s.max_dynamic_follow_ups is distinct from
        greatest(
          0,
          least(coalesce(new.max_dynamic_follow_ups, 1), 10)
        )

      or s.live_response_timeout_seconds is distinct from
        greatest(
          15,
          least(
            coalesce(new.live_response_timeout_seconds, 60),
            600
          )
        )
    );

  return new;
end;
$$;


--
-- Name: ai_interview_delivery_preflight(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_interview_delivery_preflight() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with required_columns(table_name, column_name) as (
    values
      ('ai_interview_campaigns', 'interaction_mode'),
      ('ai_interview_campaigns', 'interview_mode'),
      ('ai_interview_campaigns', 'camera_mode'),
      ('ai_interview_campaigns', 'max_dynamic_follow_ups'),
      ('ai_interview_campaigns', 'live_response_timeout_seconds'),
      ('ai_interview_sessions', 'campaign_id'),
      ('ai_interview_sessions', 'interaction_mode'),
      ('ai_interview_sessions', 'interview_mode'),
      ('ai_interview_sessions', 'camera_mode'),
      ('ai_interview_sessions', 'max_dynamic_follow_ups'),
      ('ai_interview_sessions', 'live_response_timeout_seconds'),
      ('ai_interview_campaign_candidates', 'campaign_id'),
      ('ai_interview_campaign_candidates', 'session_id')
  ),
  missing_columns as (
    select rc.table_name || '.' || rc.column_name as item
    from required_columns rc
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = rc.table_name
     and c.column_name = rc.column_name
    where c.column_name is null
  ),
  safe_trigger as (
    select count(*)::integer as trigger_count
    from pg_trigger trg
    join pg_proc proc on proc.oid = trg.tgfoid
    join pg_class cls on cls.oid = trg.tgrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where trg.tgisinternal = false
      and ns.nspname = 'public'
      and cls.relname = 'ai_interview_campaign_candidates'
      and proc.proname = 'ai_interview_campaign_candidate_sync_session_trigger'
  )
  select jsonb_build_object(
    'ok',
      not exists (select 1 from missing_columns)
      and (select trigger_count from safe_trigger) = 1,
    'schema_version', '2026-07-16.6',
    'missing_columns',
      coalesce((select jsonb_agg(item order by item) from missing_columns), '[]'::jsonb),
    'missing_triggers',
      case
        when (select trigger_count from safe_trigger) = 1 then '[]'::jsonb
        else jsonb_build_array('ai_interview_campaign_candidate_sync_session_trigger')
      end,
    'safe_campaign_candidate_trigger_count',
      (select trigger_count from safe_trigger)
  );
$$;


--
-- Name: ai_interview_enforce_campaign_delivery_on_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_interview_enforce_campaign_delivery_on_session() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_delivery record;
begin
  if new.campaign_id is null then
    return new;
  end if;

  select
    c.company_id,
    coalesce(nullif(c.interaction_mode, ''), 'Recorded')
      as interaction_mode,
    coalesce(nullif(c.interview_mode, ''), 'Voice')
      as interview_mode,
    coalesce(nullif(c.camera_mode, ''), 'Off')
      as camera_mode,
    greatest(
      0,
      least(coalesce(c.max_dynamic_follow_ups, 1), 10)
    ) as max_dynamic_follow_ups,
    greatest(
      15,
      least(coalesce(c.live_response_timeout_seconds, 60), 600)
    ) as live_response_timeout_seconds
  into v_delivery
  from public.ai_interview_campaigns c
  where c.id = new.campaign_id;

  if not found then
    raise exception
      'AI interview campaign % was not found for session delivery synchronization.',
      new.campaign_id;
  end if;

  -- Tenant-isolation safety.
  if new.company_id is null then
    new.company_id := v_delivery.company_id;
  elsif new.company_id is distinct from v_delivery.company_id then
    raise exception
      'Session company does not match campaign company.';
  end if;

  new.interaction_mode :=
    v_delivery.interaction_mode;

  new.interview_mode :=
    v_delivery.interview_mode;

  new.camera_mode :=
    v_delivery.camera_mode;

  new.max_dynamic_follow_ups :=
    v_delivery.max_dynamic_follow_ups;

  new.live_response_timeout_seconds :=
    v_delivery.live_response_timeout_seconds;

  return new;
end;
$$;


--
-- Name: ai_interview_sync_linked_session_delivery(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_interview_sync_linked_session_delivery(p_session_id uuid, p_campaign_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  delivery record;
begin
  if p_session_id is null or p_campaign_id is null then
    return;
  end if;

  select
    c.company_id,
    coalesce(c.interaction_mode, 'Recorded') as interaction_mode,
    coalesce(c.interview_mode, 'Voice') as interview_mode,
    coalesce(c.camera_mode, 'Off') as camera_mode,
    greatest(0, least(coalesce(c.max_dynamic_follow_ups, 1), 10)) as max_dynamic_follow_ups,
    greatest(15, least(coalesce(c.live_response_timeout_seconds, 60), 600)) as live_response_timeout_seconds
  into delivery
  from public.ai_interview_campaigns c
  where c.id = p_campaign_id;

  if not found then
    return;
  end if;

  -- Important: only update when at least one value is actually different.
  -- This prevents unnecessary trigger execution and breaks the old loop.
  update public.ai_interview_sessions s
  set
    campaign_id = p_campaign_id,
    interaction_mode = delivery.interaction_mode,
    interview_mode = delivery.interview_mode,
    camera_mode = delivery.camera_mode,
    max_dynamic_follow_ups = delivery.max_dynamic_follow_ups,
    live_response_timeout_seconds = delivery.live_response_timeout_seconds,
    updated_at = now()
  where s.id = p_session_id
    and s.company_id = delivery.company_id
    and (
      s.campaign_id is distinct from p_campaign_id
      or s.interaction_mode is distinct from delivery.interaction_mode
      or s.interview_mode is distinct from delivery.interview_mode
      or s.camera_mode is distinct from delivery.camera_mode
      or s.max_dynamic_follow_ups is distinct from delivery.max_dynamic_follow_ups
      or s.live_response_timeout_seconds is distinct from delivery.live_response_timeout_seconds
    );
end;
$$;


--
-- Name: assign_request_no_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_request_no_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.request_no := public.next_request_no();
  return new;
end;
$$;


--
-- Name: calculate_candidate_technical_score(numeric, numeric, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_candidate_technical_score(p_education_score numeric, p_experience_score numeric, p_skills_score numeric, p_certification_score numeric, p_language_score numeric, p_data_completeness_score numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
  select round(
    (
      coalesce(p_experience_score, 0) * 0.30 +
      coalesce(p_skills_score, 0) * 0.25 +
      coalesce(p_education_score, 0) * 0.15 +
      coalesce(p_certification_score, 0) * 0.10 +
      coalesce(p_language_score, 0) * 0.10 +
      coalesce(p_data_completeness_score, 0) * 0.10
    )::numeric,
    2
  );
$$;


SET default_table_access_method = heap;

--
-- Name: ai_interview_analysis_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_analysis_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    session_id uuid NOT NULL,
    job_type text DEFAULT 'Full Interview Analysis'::text NOT NULL,
    status text DEFAULT 'Queued'::text NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_error text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_interview_analysis_jobs_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 20))),
    CONSTRAINT ai_interview_analysis_jobs_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10))),
    CONSTRAINT ai_interview_analysis_jobs_priority_check CHECK (((priority >= 1) AND (priority <= 1000))),
    CONSTRAINT ai_interview_analysis_jobs_status_check CHECK ((status = ANY (ARRAY['Queued'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text, 'Cancelled'::text])))
);


--
-- Name: claim_ai_interview_analysis_job(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text DEFAULT 'ai-interview-worker'::text) RETURNS SETOF public.ai_interview_analysis_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job public.ai_interview_analysis_jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM public.ai_interview_analysis_jobs
  WHERE status = 'Queued'
    AND available_at <= now()
    AND attempt_count < max_attempts
  ORDER BY priority ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.ai_interview_analysis_jobs
  SET
    status = 'Processing',
    attempt_count = attempt_count + 1,
    locked_at = now(),
    locked_by = coalesce(nullif(trim(p_worker_name), ''), 'ai-interview-worker'),
    started_at = coalesce(started_at, now()),
    last_error = '',
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE public.ai_interview_sessions
  SET
    analysis_status = 'Transcribing',
    analysis_started_at = coalesce(analysis_started_at, now()),
    analysis_attempts = v_job.attempt_count,
    analysis_error = '',
    updated_at = now()
  WHERE id = v_job.session_id;

  RETURN NEXT v_job;
END;
$$;


--
-- Name: ai_interview_invitation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_invitation_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    campaign_candidate_id uuid NOT NULL,
    session_id uuid,
    job_type text DEFAULT 'Invitation'::text NOT NULL,
    recipient_email text NOT NULL,
    recipient_name text DEFAULT ''::text NOT NULL,
    language text DEFAULT 'Bilingual'::text NOT NULL,
    status text DEFAULT 'Queued'::text NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text DEFAULT ''::text NOT NULL,
    sent_at timestamp with time zone,
    message_id text DEFAULT ''::text NOT NULL,
    last_error text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_interview_invitation_jobs_attempts_check CHECK (((attempt_count >= 0) AND ((max_attempts >= 1) AND (max_attempts <= 10)) AND (attempt_count <= max_attempts))),
    CONSTRAINT ai_interview_invitation_jobs_language_check CHECK ((language = ANY (ARRAY['Arabic'::text, 'English'::text, 'Bilingual'::text]))),
    CONSTRAINT ai_interview_invitation_jobs_priority_check CHECK (((priority >= 1) AND (priority <= 1000))),
    CONSTRAINT ai_interview_invitation_jobs_status_check CHECK ((status = ANY (ARRAY['Queued'::text, 'Processing'::text, 'Sent'::text, 'Failed'::text, 'Cancelled'::text, 'Skipped'::text]))),
    CONSTRAINT ai_interview_invitation_jobs_type_check CHECK ((job_type = ANY (ARRAY['Invitation'::text, 'Reminder 1'::text, 'Reminder 2'::text, 'Final Reminder'::text, 'Manual Resend'::text])))
);


--
-- Name: claim_ai_interview_invitation_jobs(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_ai_interview_invitation_jobs(p_limit integer DEFAULT 20, p_worker text DEFAULT 'ai-interview-invitation-worker'::text) RETURNS SETOF public.ai_interview_invitation_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Recover jobs abandoned by an interrupted worker.
  UPDATE public.ai_interview_invitation_jobs
  SET
    status = CASE
      WHEN attempt_count >= max_attempts THEN 'Failed'
      ELSE 'Queued'
    END,
    available_at = CASE
      WHEN attempt_count >= max_attempts THEN available_at
      ELSE now()
    END,
    locked_at = NULL,
    locked_by = '',
    last_error = CASE
      WHEN attempt_count >= max_attempts
        THEN coalesce(nullif(last_error, ''), 'Worker lock expired after maximum attempts.')
      ELSE coalesce(nullif(last_error, ''), 'Previous worker lock expired; job requeued.')
    END,
    updated_at = now()
  WHERE status = 'Processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH selected_jobs AS (
    SELECT j.id
    FROM public.ai_interview_invitation_jobs j
    WHERE j.status = 'Queued'
      AND j.available_at <= now()
      AND j.attempt_count < j.max_attempts
    ORDER BY j.priority ASC, j.available_at ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
  )
  UPDATE public.ai_interview_invitation_jobs j
  SET
    status = 'Processing',
    attempt_count = j.attempt_count + 1,
    locked_at = now(),
    locked_by = coalesce(nullif(btrim(p_worker), ''), 'ai-interview-invitation-worker'),
    last_error = '',
    updated_at = now()
  FROM selected_jobs s
  WHERE j.id = s.id
  RETURNING j.*;
END;
$$;


--
-- Name: complete_ai_interview_analysis_job(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_session_id uuid;
BEGIN
  UPDATE public.ai_interview_analysis_jobs
  SET
    status = 'Completed',
    result = coalesce(p_result, '{}'::jsonb),
    completed_at = now(),
    locked_at = NULL,
    locked_by = '',
    last_error = '',
    updated_at = now()
  WHERE id = p_job_id
  RETURNING session_id INTO v_session_id;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Analysis job % was not found', p_job_id;
  END IF;

  UPDATE public.ai_interview_sessions
  SET
    analysis_status = 'Completed',
    analysis_completed_at = now(),
    analysis_error = '',
    updated_at = now()
  WHERE id = v_session_id;
END;
$$;


--
-- Name: complete_ai_interview_invitation_job(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_ai_interview_invitation_job(p_job_id uuid, p_message_id text DEFAULT ''::text, p_provider text DEFAULT 'VisaFlow Email Dispatcher'::text) RETURNS public.ai_interview_invitation_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job public.ai_interview_invitation_jobs%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  UPDATE public.ai_interview_invitation_jobs
  SET
    status = 'Sent',
    sent_at = coalesce(sent_at, v_now),
    message_id = coalesce(p_message_id, ''),
    last_error = '',
    locked_at = NULL,
    locked_by = '',
    payload = coalesce(payload, '{}'::jsonb)
      || jsonb_build_object(
        'provider', coalesce(p_provider, 'VisaFlow Email Dispatcher'),
        'completed_at', v_now
      ),
    updated_at = v_now
  WHERE id = p_job_id
    AND status IN ('Processing', 'Sent')
  RETURNING *
  INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation job % was not found or is not claimable.', p_job_id;
  END IF;

  UPDATE public.ai_interview_sessions
  SET
    candidate_email = coalesce(nullif(v_job.recipient_email, ''), candidate_email),
    invitation_sent_at = coalesce(invitation_sent_at, v_now),
    status = CASE
      WHEN status IN ('Created', 'Invitation Pending') THEN 'Invited'
      ELSE status
    END,
    updated_by = 'AI Interview Invitation Worker',
    updated_at = v_now
  WHERE id = v_job.session_id;

  UPDATE public.ai_interview_campaign_candidates
  SET
    invitation_status = 'Sent',
    status = CASE
      WHEN status IN ('Pending', 'Queued for Invitation', 'Failed')
        THEN 'Invitation Sent'
      ELSE status
    END,
    invited_at = coalesce(invited_at, v_now),
    last_error = '',
    updated_at = v_now
  WHERE id = v_job.campaign_candidate_id;

  PERFORM public.refresh_ai_interview_campaign_counts(v_job.campaign_id);

  -- The dispatcher may already write an email log. This insert is guarded
  -- by the invitation job ID to avoid duplicate worker logs.
  IF to_regclass('public.email_logs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.email_logs e
       WHERE e.type = 'AI_INTERVIEW_CAMPAIGN_INVITATION'
         AND e.payload ->> 'invitation_job_id' = v_job.id::text
         AND lower(coalesce(e.status, '')) = 'sent'
     ) THEN
    INSERT INTO public.email_logs (
      company_id,
      type,
      status,
      to_email,
      subject,
      provider,
      message_id,
      error_message,
      payload,
      created_at
    )
    VALUES (
      v_job.company_id,
      'AI_INTERVIEW_CAMPAIGN_INVITATION',
      'Sent',
      v_job.recipient_email,
      coalesce(
        nullif(v_job.payload ->> 'subject', ''),
        'AI Interview Invitation / ط·آ·ط¢آ¯ط·آ·ط¢آ¹ط·آ¸ط«â€ ط·آ·ط¢آ© ط·آ¸أ¢â‚¬آ¦ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ§ط·آ·ط¢آ¨ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ© ط·آ·ط¢آ°ط·آ¸ط¦â€™ط·آ¸ط¸آ¹ط·آ·ط¢آ©'
      ),
      coalesce(p_provider, 'VisaFlow Email Dispatcher'),
      coalesce(p_message_id, ''),
      '',
      coalesce(v_job.payload, '{}'::jsonb)
        || jsonb_build_object(
          'invitation_job_id', v_job.id,
          'campaign_id', v_job.campaign_id,
          'campaign_candidate_id', v_job.campaign_candidate_id,
          'session_id', v_job.session_id
        ),
      v_now
    );
  END IF;

  RETURN v_job;
END;
$$;


--
-- Name: create_ai_interview_template_version(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_old public.ai_interview_templates%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_group_id uuid;
  v_next_version integer;
  v_template_payload jsonb;
  v_question record;
  v_question_payload jsonb;
begin
  select *
  into v_old
  from public.ai_interview_templates
  where id = p_template_id
  for update;

  if not found then
    raise exception 'Template not found: %', p_template_id;
  end if;

  v_group_id := coalesce(v_old.template_group_id, v_old.id);

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.ai_interview_templates
  where template_group_id = v_group_id;

  update public.ai_interview_templates
  set
    is_current_version = false,
    updated_at = now()
  where template_group_id = v_group_id
    and is_current_version = true;

  /*
    ط·آ¸أ¢â‚¬آ ط·آ·ط¢آ³ط·آ·ط¢آ® ط·آ·ط¢آ¬ط·آ¸أ¢â‚¬آ¦ط·آ¸ط¸آ¹ط·آ·ط¢آ¹ ط·آ·ط¢آ¨ط·آ¸ط¸آ¹ط·آ·ط¢آ§ط·آ¸أ¢â‚¬آ ط·آ·ط¢آ§ط·آ·ط¹آ¾ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¨ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ³ط·آ·ط¢آ§ط·آ·ط¢آ¨ط·آ¸أ¢â‚¬ع‘ ط·آ·ط¹آ¾ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ§ط·آ·ط¢آ¦ط·آ¸ط¸آ¹ط·آ¸أ¢â‚¬آ¹ط·آ·ط¢آ§ط·آ·ط¥â€™
    ط·آ·ط¢آ«ط·آ¸أ¢â‚¬آ¦ ط·آ·ط¹آ¾ط·آ·ط·â€؛ط·آ¸ط¸آ¹ط·آ¸ط¸آ¹ط·آ·ط¢آ± ط·آ·ط¢آ¨ط·آ¸ط¸آ¹ط·آ·ط¢آ§ط·آ¸أ¢â‚¬آ ط·آ·ط¢آ§ط·آ·ط¹آ¾ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¥ط·آ·ط¢آµط·آ·ط¢آ¯ط·آ·ط¢آ§ط·آ·ط¢آ± ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¬ط·آ·ط¢آ¯ط·آ¸ط¸آ¹ط·آ·ط¢آ¯ ط·آ¸ط¸آ¾ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ·.
  */
  v_template_payload :=
    to_jsonb(v_old)
    || jsonb_build_object(
      'id', v_new_id,
      'template_group_id', v_group_id,
      'version_number', v_next_version,
      'version', v_next_version,
      'is_current_version', true,
      'supersedes_template_id', v_old.id,
      'version_notes', coalesce(p_version_notes, ''),

      'status', 'Draft',
      'approval_status', 'Draft',
      'is_active', false,
      'is_locked', false,

      /*
        ط·آ¸أ¢â‚¬طŒط·آ·ط¢آ°ط·آ¸أ¢â‚¬طŒ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ­ط·آ¸أ¢â‚¬ع‘ط·آ¸ط«â€ ط·آ¸أ¢â‚¬â€چ NOT NULL ط·آ¸ط¸آ¾ط·آ¸ط¸آ¹ ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ§ط·آ·ط¢آ¹ط·آ·ط¢آ¯ط·آ·ط¢آ© ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¨ط·آ¸ط¸آ¹ط·آ·ط¢آ§ط·آ¸أ¢â‚¬آ ط·آ·ط¢آ§ط·آ·ط¹آ¾ط·آ·ط¥â€™
        ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ°ط·آ¸أ¢â‚¬â€چط·آ¸ط¦â€™ ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ§ ط·آ¸أ¢â‚¬آ ط·آ·ط¢آ¶ط·آ·ط¢آ¹ NULL.
      */
      'approved_by', coalesce(
        nullif(trim(v_old.approved_by), ''),
        nullif(trim(v_old.created_by), ''),
        'System'
      ),
      'rejected_by', '',
      'rejection_reason', '',
      'generation_error', '',

      'approved_at', v_old.approved_at,
      'rejected_at', null,

      'created_at', now(),
      'updated_at', now()
    );

  insert into public.ai_interview_templates
  select (
    jsonb_populate_record(
      null::public.ai_interview_templates,
      v_template_payload
    )
  ).*;

  /*
    ط·آ¸أ¢â‚¬آ ط·آ·ط¢آ³ط·آ·ط¢آ® ط·آ·ط¢آ¬ط·آ¸أ¢â‚¬آ¦ط·آ¸ط¸آ¹ط·آ·ط¢آ¹ ط·آ·ط¢آ£ط·آ·ط¢آ³ط·آ·ط¢آ¦ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ© ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¨ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ³ط·آ·ط¢آ§ط·آ·ط¢آ¨ط·آ¸أ¢â‚¬ع‘ ط·آ·ط¢آ¨ط·آ·ط¢آ£ط·آ·ط¢آ±ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ§ط·آ¸أ¢â‚¬آ¦ ID ط·آ·ط¢آ¬ط·آ·ط¢آ¯ط·آ¸ط¸آ¹ط·آ·ط¢آ¯ط·آ·ط¢آ©.
  */
  for v_question in
    select *
    from public.ai_interview_questions
    where template_id = v_old.id
    order by question_order
  loop
    v_question_payload :=
      to_jsonb(v_question)
      || jsonb_build_object(
        'id', gen_random_uuid(),
        'template_id', v_new_id,
        'is_locked', false,
        'created_at', now(),
        'updated_at', now()
      );

    insert into public.ai_interview_questions
    select (
      jsonb_populate_record(
        null::public.ai_interview_questions,
        v_question_payload
      )
    ).*;
  end loop;

  return v_new_id;
end;
$$;


--
-- Name: create_onboarding_validation_from_candidate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_onboarding_validation_from_candidate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_start_date date;
  v_has_agency boolean;
begin
  if new.company_id is null then
    return new;
  end if;

  if new.status not in ('Arrived KSA', 'Arrived', 'Joined') then
    return new;
  end if;

  v_start_date := coalesce(
    nullif(new.joining_date::text, '')::date,
    nullif(new.arrival_date::text, '')::date,
    current_date
  );

  v_has_agency := nullif(trim(coalesce(new.agency, '')), '') is not null;

  insert into public.onboarding_validations (
    company_id,
    candidate_id,
    request_no,
    candidate_name,
    passport_no,
    agency_name,
    profession,
    nationality,
    project,
    arrival_date,
    joining_date,
    validation_start_date,
    validation_due_date,
    worker_validation_required,
    agency_impact_eligible,
    validation_scope,
    agency_impact_type,
    agency_impact_score,
    status,
    final_result
  )
  values (
    new.company_id,
    new.id,
    new.request_no,
    new.candidate_name,
    new.passport_no,
    new.agency,
    new.profession,
    new.nationality,
    new.project,
    nullif(new.arrival_date::text, '')::date,
    nullif(new.joining_date::text, '')::date,
    v_start_date,
    v_start_date + interval '90 days',
    true,
    v_has_agency,
    case when v_has_agency then 'Worker + Agency Impact' else 'Worker Only' end,
    case when v_has_agency then 'Neutral' else 'Not Applicable' end,
    0,
    'Active Monitoring',
    'Under Monitoring'
  )
  on conflict (company_id, candidate_id)
  do update set
    request_no = excluded.request_no,
    candidate_name = excluded.candidate_name,
    passport_no = excluded.passport_no,
    agency_name = excluded.agency_name,
    profession = excluded.profession,
    nationality = excluded.nationality,
    project = excluded.project,
    arrival_date = excluded.arrival_date,
    joining_date = excluded.joining_date,
    agency_impact_eligible = excluded.agency_impact_eligible,
    validation_scope = excluded.validation_scope,
    agency_impact_type = excluded.agency_impact_type,
    agency_impact_score = excluded.agency_impact_score,
    updated_at = now();

  return new;
end;
$$;


--
-- Name: current_app_agency_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_agency_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.agency_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and coalesce(u.is_active, true) = true
    and lower(coalesce(u.status, 'active')) = 'active'
  limit 1;
$$;


--
-- Name: current_app_company_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_company_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.company_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and coalesce(u.is_active, true) = true
    and lower(coalesce(u.status, 'active')) = 'active'
  limit 1;
$$;


--
-- Name: current_app_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.role
  from public.users u
  where u.auth_user_id = auth.uid()
    and coalesce(u.is_active, true) = true
    and lower(coalesce(u.status, 'active')) = 'active'
  limit 1;
$$;


--
-- Name: current_app_user_agency_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_user_agency_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.agency_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and coalesce(u.status, 'Active') = 'Active'
  limit 1;
$$;


--
-- Name: current_app_user_company_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_user_company_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.company_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and coalesce(u.status, 'Active') = 'Active'
  limit 1;
$$;


--
-- Name: current_app_user_has_role(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_user_has_role(allowed_roles text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.current_app_user_role() = any(allowed_roles);
$$;


--
-- Name: current_app_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_user_id() RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
    and coalesce(u.status, 'Active') = 'Active'
  limit 1;
$$;


--
-- Name: current_app_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_user_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.role
  from public.users u
  where u.auth_user_id = auth.uid()
    and coalesce(u.status, 'Active') = 'Active'
  limit 1;
$$;


--
-- Name: current_log_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_log_actor() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  linked_rows bigint;
  actor jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;

  select count(*)
  into linked_rows
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if linked_rows <> 1 then
    return null;
  end if;

  select jsonb_build_object(
    'id', app_user.id,
    'role', app_user.role,
    'company_id', app_user.company_id,
    'agency_id', app_user.agency_id
  )
  into actor
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active'
    and app_user.is_active is true
    and (
      app_user.company_id is null
      or exists (
        select 1
        from public.companies as company
        where company.id = app_user.company_id
          and company.status = 'Active'
      )
    )
    and (
      app_user.role <> 'Agency'
      or (
        app_user.agency_id is not null
        and exists (
          select 1
          from public.agencies as agency
          where agency.id = app_user.agency_id
            and agency.status = 'Active'
        )
      )
    )
    and (
      app_user.role not in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
      or app_user.company_id is null
    );

  return actor;
end;
$$;


--
-- Name: enqueue_ai_interview_analysis_on_completion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_ai_interview_analysis_on_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.queue_ai_interview_analysis(NEW.id);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    UPDATE public.ai_interview_sessions
    SET
      analysis_status = 'Failed',
      analysis_error = left(SQLERRM, 2000),
      updated_at = now()
    WHERE id = NEW.id;

    RETURN NEW;
END;
$$;


--
-- Name: fail_ai_interview_analysis_job(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job public.ai_interview_analysis_jobs%ROWTYPE;
  v_next_status text;
  v_delay_minutes integer;
BEGIN
  SELECT *
  INTO v_job
  FROM public.ai_interview_analysis_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analysis job % was not found', p_job_id;
  END IF;

  IF v_job.attempt_count >= v_job.max_attempts THEN
    v_next_status := 'Failed';
  ELSE
    v_next_status := 'Queued';
  END IF;

  v_delay_minutes := LEAST(30, GREATEST(5, v_job.attempt_count * 5));

  UPDATE public.ai_interview_analysis_jobs
  SET
    status = v_next_status,
    available_at = CASE
      WHEN v_next_status = 'Queued'
        THEN now() + (v_delay_minutes || ' minutes')::interval
      ELSE available_at
    END,
    locked_at = NULL,
    locked_by = '',
    last_error = left(coalesce(p_error, 'Unknown analysis error'), 4000),
    completed_at = CASE WHEN v_next_status = 'Failed' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_job_id;

  UPDATE public.ai_interview_sessions
  SET
    analysis_status = CASE
      WHEN v_next_status = 'Failed' THEN 'Failed'
      ELSE 'Queued'
    END,
    analysis_error = left(coalesce(p_error, 'Unknown analysis error'), 2000),
    analysis_last_queued_at = CASE
      WHEN v_next_status = 'Queued' THEN now()
      ELSE analysis_last_queued_at
    END,
    updated_at = now()
  WHERE id = v_job.session_id;

  RETURN v_next_status;
END;
$$;


--
-- Name: fail_ai_interview_invitation_job(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_ai_interview_invitation_job(p_job_id uuid, p_error text, p_retry_delay_minutes integer DEFAULT 5) RETURNS public.ai_interview_invitation_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job public.ai_interview_invitation_jobs%ROWTYPE;
  v_final_failure boolean;
  v_now timestamptz := now();
BEGIN
  SELECT *
  INTO v_job
  FROM public.ai_interview_invitation_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation job % was not found.', p_job_id;
  END IF;

  v_final_failure := v_job.attempt_count >= v_job.max_attempts;

  UPDATE public.ai_interview_invitation_jobs
  SET
    status = CASE WHEN v_final_failure THEN 'Failed' ELSE 'Queued' END,
    available_at = CASE
      WHEN v_final_failure THEN available_at
      ELSE v_now + make_interval(mins => greatest(1, coalesce(p_retry_delay_minutes, 5)))
    END,
    locked_at = NULL,
    locked_by = '',
    last_error = left(coalesce(nullif(p_error, ''), 'Unknown invitation delivery error.'), 4000),
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING *
  INTO v_job;

  UPDATE public.ai_interview_campaign_candidates
  SET
    invitation_status = CASE WHEN v_final_failure THEN 'Failed' ELSE 'Queued' END,
    status = CASE
      WHEN v_final_failure THEN 'Failed'
      WHEN status = 'Failed' THEN 'Queued for Invitation'
      ELSE status
    END,
    last_error = left(coalesce(nullif(p_error, ''), 'Unknown invitation delivery error.'), 4000),
    updated_at = v_now
  WHERE id = v_job.campaign_candidate_id;

  IF to_regclass('public.email_logs') IS NOT NULL THEN
    INSERT INTO public.email_logs (
      company_id,
      type,
      status,
      to_email,
      subject,
      provider,
      message_id,
      error_message,
      payload,
      created_at
    )
    VALUES (
      v_job.company_id,
      'AI_INTERVIEW_CAMPAIGN_INVITATION',
      CASE WHEN v_final_failure THEN 'Failed' ELSE 'Retry Queued' END,
      v_job.recipient_email,
      coalesce(
        nullif(v_job.payload ->> 'subject', ''),
        'AI Interview Invitation / ط·آ·ط¢آ¯ط·آ·ط¢آ¹ط·آ¸ط«â€ ط·آ·ط¢آ© ط·آ¸أ¢â‚¬آ¦ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ§ط·آ·ط¢آ¨ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ© ط·آ·ط¢آ°ط·آ¸ط¦â€™ط·آ¸ط¸آ¹ط·آ·ط¢آ©'
      ),
      'VisaFlow Email Dispatcher',
      '',
      left(coalesce(nullif(p_error, ''), 'Unknown invitation delivery error.'), 4000),
      coalesce(v_job.payload, '{}'::jsonb)
        || jsonb_build_object(
          'invitation_job_id', v_job.id,
          'campaign_id', v_job.campaign_id,
          'campaign_candidate_id', v_job.campaign_candidate_id,
          'session_id', v_job.session_id,
          'attempt_count', v_job.attempt_count,
          'max_attempts', v_job.max_attempts,
          'final_failure', v_final_failure
        ),
      v_now
    );
  END IF;

  PERFORM public.refresh_ai_interview_campaign_counts(v_job.campaign_id);

  RETURN v_job;
END;
$$;


--
-- Name: generate_request_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_request_no() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.request_no is null or new.request_no = '' then
    new.request_no := 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.request_no_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;


--
-- Name: get_ai_interview_invitation_queue_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ai_interview_invitation_queue_summary(p_campaign_id uuid DEFAULT NULL::uuid) RETURNS TABLE(status text, records bigint, oldest_available_at timestamp with time zone, newest_created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    j.status,
    count(*) AS records,
    min(j.available_at) AS oldest_available_at,
    max(j.created_at) AS newest_created_at
  FROM public.ai_interview_invitation_jobs j
  WHERE p_campaign_id IS NULL OR j.campaign_id = p_campaign_id
  GROUP BY j.status
  ORDER BY j.status;
$$;


--
-- Name: get_authenticated_app_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_authenticated_app_user() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  matched_user jsonb;
  linked_rows bigint;
begin
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select count(*)
  into linked_rows
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if linked_rows <> 1 then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', app_user.id,
    'name', app_user.name,
    'email', app_user.email,
    'role', app_user.role,
    'status', app_user.status,
    'company_id', app_user.company_id,
    'agency_id', app_user.agency_id,
    'agency_name', app_user.agency_name,
    'auth_user_id', app_user.auth_user_id,
    'created_at', app_user.created_at
  )
  into matched_user
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active'
    and app_user.is_active is true
    and (
      app_user.company_id is null
      or exists (
        select 1
        from public.companies as company
        where company.id = app_user.company_id
          and company.status = 'Active'
      )
    )
    and (
      app_user.role <> 'Agency'
      or (
        app_user.agency_id is not null
        and exists (
          select 1
          from public.agencies as agency
          where agency.id = app_user.agency_id
            and agency.status = 'Active'
        )
      )
    )
    and (
      app_user.role not in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
      or app_user.company_id is null
    );

  if matched_user is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return matched_user;
end;
$$;


--
-- Name: get_candidate_interview_priority(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_candidate_interview_priority(p_score numeric) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when coalesce(p_score, 0) >= 85 then 'Interview First'
    when coalesce(p_score, 0) >= 70 then 'Shortlist'
    when coalesce(p_score, 0) >= 55 then 'Review'
    else 'Low Priority'
  end;
$$;


--
-- Name: get_owner_talent_dashboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_owner_talent_dashboard() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_records bigint;
  v_email_confirmed bigint;
  v_cv_uploaded bigint;
  v_profile_completed bigint;
  v_ai_analyzed bigint;
  v_approved bigint;
  v_latest_profiles jsonb;
  v_country_distribution jsonb;
  v_profession_distribution jsonb;
  v_status_distribution jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.users as platform_user
    where platform_user.auth_user_id = auth.uid()
      and lower(coalesce(platform_user.status, '')) = 'active'
      and platform_user.is_active is true
      and platform_user.company_id is null
      and platform_user.role in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'access denied';
  end if;

  select count(*)
  into v_profile_records
  from public.talent_candidates;

  select count(distinct candidate.id)
  into v_email_confirmed
  from public.talent_candidates as candidate
  join auth.users as auth_user
    on auth_user.id = candidate.auth_user_id
  where auth_user.email_confirmed_at is not null;

  select count(distinct candidate.id)
  into v_cv_uploaded
  from public.talent_candidate_documents as document
  join public.talent_candidates as candidate
    on candidate.id = document.candidate_id
  where document.document_type = 'CV'
    and document.is_primary is true;

  select count(*)
  into v_profile_completed
  from public.talent_candidates as candidate
  where candidate.submitted_at is not null;

  select count(*)
  into v_ai_analyzed
  from public.talent_candidates as candidate
  where candidate.ai_cv_status = 'Completed';

  select count(*)
  into v_approved
  from public.talent_candidates as candidate
  where candidate.marketplace_status = 'Approved'
    and candidate.employer_sharing_consent is true;

  select coalesce(jsonb_agg(to_jsonb(latest_profile) order by latest_profile.created_at desc), '[]'::jsonb)
  into v_latest_profiles
  from (
    select
      candidate.full_name,
      candidate.email,
      candidate.country_of_residence,
      candidate.profession,
      candidate.marketplace_status,
      candidate.created_at
    from public.talent_candidates as candidate
    order by candidate.created_at desc
    limit 10
  ) as latest_profile;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_country_distribution
  from (
    select coalesce(nullif(trim(candidate.country_of_residence), ''), 'Not specified') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.country_of_residence), ''), 'Not specified')
    order by total desc
    limit 10
  ) as grouped;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_profession_distribution
  from (
    select coalesce(nullif(trim(candidate.profession), ''), 'Not specified') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.profession), ''), 'Not specified')
    order by total desc
    limit 10
  ) as grouped;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_status_distribution
  from (
    select coalesce(nullif(trim(candidate.marketplace_status), ''), 'Draft') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.marketplace_status), ''), 'Draft')
    order by total desc
    limit 10
  ) as grouped;

  return jsonb_build_object(
    'profile_records', v_profile_records,
    'email_confirmed', v_email_confirmed,
    'email_confirmed_available', true,
    'cv_uploaded', v_cv_uploaded,
    'profile_completed', v_profile_completed,
    'ai_analyzed', v_ai_analyzed,
    'approved', v_approved,
    'latest_profiles', v_latest_profiles,
    'distributions', jsonb_build_object(
      'country_of_residence', v_country_distribution,
      'profession', v_profession_distribution,
      'marketplace_status', v_status_distribution
    )
  );
end;
$$;


--
-- Name: get_talent_public_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_talent_public_stats() RETURNS TABLE(registered_candidates bigint, marketplace_ready bigint, completed_ai_interviews bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    count(*)::bigint,
    count(*) filter (
      where marketplace_status = 'Approved'
        and employer_sharing_consent = true
        and profile_visibility in ('Anonymized', 'Public')
    )::bigint,
    count(*) filter (where ai_interview_status = 'Completed')::bigint
  from public.talent_candidates;
$$;


--
-- Name: guard_agency_company_user_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_agency_company_user_access() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_user_role text;
  v_user_agency_id uuid;
begin
  if new.company_id is null then
    raise exception 'SECURITY BLOCK: company_id is required for agency user access.';
  end if;

  if new.agency_id is null then
    raise exception 'SECURITY BLOCK: agency_id is required for agency user access.';
  end if;

  if new.user_id is null then
    raise exception 'SECURITY BLOCK: user_id is required for agency user access.';
  end if;

  select role, agency_id
  into v_user_role, v_user_agency_id
  from public.users
  where id = new.user_id;

  if v_user_role is null then
    raise exception 'SECURITY BLOCK: user does not exist.';
  end if;

  if v_user_role <> 'Agency' then
    raise exception 'SECURITY BLOCK: only Agency role users can be granted agency workspace access.';
  end if;

  if v_user_agency_id is null then
    raise exception 'SECURITY BLOCK: Agency user must have agency_id.';
  end if;

  if v_user_agency_id <> new.agency_id then
    raise exception 'SECURITY BLOCK: Agency user agency_id must match the granted agency_id.';
  end if;

  if not exists (
    select 1
    from public.company_agency_access caa
    where caa.company_id = new.company_id
      and caa.agency_id = new.agency_id
      and coalesce(caa.status, 'Active') = 'Active'
  ) then
    raise exception 'SECURITY BLOCK: company_agency_access must exist before granting agency user access.';
  end if;

  return new;
end;
$$;


--
-- Name: guard_company_agency_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_company_agency_access() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if new.company_id is null then
    raise exception 'SECURITY BLOCK: company_id is required for agency access.';
  end if;

  if new.agency_id is null then
    raise exception 'SECURITY BLOCK: agency_id is required for agency access.';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = new.company_id
  ) then
    raise exception 'SECURITY BLOCK: company does not exist.';
  end if;

  if not exists (
    select 1 from public.agencies a
    where a.id = new.agency_id
  ) then
    raise exception 'SECURITY BLOCK: agency does not exist.';
  end if;

  return new;
end;
$$;


--
-- Name: guard_platform_user_roles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_platform_user_roles() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  -- Allow direct database administration from Supabase SQL Editor / postgres.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- Protect platform roles from browser/app changes.
  if coalesce(new.role, '') in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
     or coalesce(old.role, '') in ('Platform Owner', 'Platform Accounts User', 'Platform Support User') then

    if auth.uid() is null then
      raise exception 'SECURITY BLOCK: platform roles can only be managed by authenticated platform users.';
    end if;

    if not exists (
      select 1
      from public.users u
      where u.auth_user_id = auth.uid()
        and u.role = 'Platform Owner'
        and coalesce(u.status, 'Active') = 'Active'
    ) then
      raise exception 'SECURITY BLOCK: only active Platform Owner can manage platform roles.';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: guard_users_security(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_users_security() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_role text := coalesce(new.role, 'Viewer');
begin
  new.email := lower(trim(new.email));
  new.updated_at := now();

  if new.email is null or new.email = '' then
    raise exception 'Email is required.';
  end if;

  -- Platform users
  if v_role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User') then
    new.company_id := null;
    new.agency_id := null;
    new.agency_name := null;

    -- Only active platform users must be linked to Supabase Auth.
    -- Inactive old records are allowed only if already existing, but should preferably be deleted.
    if coalesce(new.status, 'Active') = 'Active' and new.auth_user_id is null then
      raise exception 'Active platform users must be linked to Supabase Auth.';
    end if;

  -- Agency users
  elsif v_role = 'Agency' then
    new.company_id := null;

    if new.agency_id is null then
      raise exception 'Agency users must have agency_id.';
    end if;

  -- Company users
  else
    if new.company_id is null then
      raise exception 'Company users must have company_id.';
    end if;

    new.agency_id := null;
    new.agency_name := null;
  end if;

  new.role := v_role;

  return new;
end;
$$;


--
-- Name: handle_new_talent_candidate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_talent_candidate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(new.raw_user_meta_data->>'account_type', '') = 'candidate' then
    insert into public.talent_candidates (
      auth_user_id,
      email,
      full_name,
      phone,
      last_active_at
    ) values (
      new.id,
      new.email,
      nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
      nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
      now()
    )
    on conflict (auth_user_id) do update
      set email = excluded.email,
          full_name = coalesce(excluded.full_name, public.talent_candidates.full_name),
          phone = coalesce(excluded.phone, public.talent_candidates.phone),
          last_active_at = now(),
          updated_at = now();
  end if;

  return new;
end;
$$;


--
-- Name: is_agency_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_agency_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(public.current_app_role(), '') = 'Agency';
$$;


--
-- Name: is_company_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_company_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.current_app_company_id() is not null
    and coalesce(public.current_app_role(), '') <> 'Agency';
$$;


--
-- Name: is_current_platform_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_current_platform_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and coalesce(u.status, 'Active') = 'Active'
      and u.role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
  );
$$;


--
-- Name: is_platform_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(public.current_app_role(), '') in (
    'Platform Owner',
    'Platform Accounts User',
    'Platform Support User'
  );
$$;


--
-- Name: launch_ai_interview_campaign(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text DEFAULT 'https://visaflowksa.com'::text) RETURNS TABLE(campaign_id uuid, campaign_status text, valid_candidates integer, sessions_created integer, existing_sessions integer, invitation_jobs_queued integer, invalid_candidates_skipped integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
DECLARE
  v_campaign public.ai_interview_campaigns%ROWTYPE;
  v_template public.ai_interview_templates%ROWTYPE;
  v_candidate public.ai_interview_campaign_candidates%ROWTYPE;
  v_session_id uuid;
  v_access_token text;
  v_invitation_url text;
  v_question_count integer := 0;
  v_valid_count integer := 0;
  v_created_count integer := 0;
  v_existing_count integer := 0;
  v_jobs_count integer := 0;
  v_invalid_count integer := 0;
  v_actor_name text := 'VisaFlow AI Interview Campaign';
  v_base_url text;
  v_deadline timestamptz;
  v_existing_session_id uuid;
BEGIN
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Campaign ID is required.';
  END IF;

  v_base_url := regexp_replace(
    coalesce(nullif(btrim(p_app_base_url), ''), 'https://visaflowksa.com'),
    '/+$',
    ''
  );

  SELECT c.*
  INTO v_campaign
  FROM public.ai_interview_campaigns AS c
  WHERE c.id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'AI interview campaign % was not found.',
      p_campaign_id;
  END IF;

  IF v_campaign.status IN ('Completed', 'Cancelled') THEN
    RAISE EXCEPTION
      'Campaign % cannot be launched because its status is %.',
      v_campaign.campaign_name,
      v_campaign.status;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT coalesce(u.name, u.email, 'VisaFlow User')
    INTO v_actor_name
    FROM public.users AS u
    WHERE u.auth_user_id = auth.uid()
      AND lower(coalesce(u.status, 'Active')) = 'active'
      AND (
        u.company_id = v_campaign.company_id
        OR lower(coalesce(u.role, '')) = 'platform owner'
      )
    LIMIT 1;

    IF v_actor_name IS NULL THEN
      RAISE EXCEPTION
        'You do not have access to launch this campaign.';
    END IF;
  END IF;

  SELECT t.*
  INTO v_template
  FROM public.ai_interview_templates AS t
  WHERE t.id = v_campaign.template_id
    AND t.status = 'Active'
    AND t.approval_status = 'Approved'
    AND t.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The selected AI interview template is not approved and active.';
  END IF;

  SELECT count(*)::integer
  INTO v_question_count
  FROM public.ai_interview_questions AS q
  WHERE q.template_id = v_template.id
    AND q.is_active = true;

  IF v_question_count < 3 THEN
    RAISE EXCEPTION
      'The selected template must contain at least 3 active questions. Current count: %.',
      v_question_count;
  END IF;

  PERFORM public.revalidate_ai_interview_campaign_candidates(
    p_campaign_id
  );

  SELECT
    count(*) FILTER (
      WHERE cc.validation_status = 'Valid'
    )::integer,
    count(*) FILTER (
      WHERE cc.validation_status <> 'Valid'
    )::integer
  INTO v_valid_count, v_invalid_count
  FROM public.ai_interview_campaign_candidates AS cc
  WHERE cc.campaign_id = p_campaign_id;

  IF v_valid_count = 0 THEN
    RAISE EXCEPTION
      'The campaign has no valid candidates with usable email addresses.';
  END IF;

  v_deadline := coalesce(
    v_campaign.interview_deadline,
    now() + interval '7 days'
  );

  IF v_deadline <= now() THEN
    RAISE EXCEPTION
      'The interview deadline must be in the future.';
  END IF;

  UPDATE public.ai_interview_campaigns AS c
  SET
    status = 'Launching',
    interview_deadline = v_deadline,
    launched_at = coalesce(c.launched_at, now()),
    updated_at = now()
  WHERE c.id = p_campaign_id;

  FOR v_candidate IN
    SELECT cc.*
    FROM public.ai_interview_campaign_candidates AS cc
    WHERE cc.campaign_id = p_campaign_id
      AND cc.validation_status = 'Valid'
      AND cc.status NOT IN ('Cancelled', 'Expired')
    ORDER BY cc.created_at, cc.id
    FOR UPDATE
  LOOP
    v_existing_session_id := NULL;

    SELECT s.id
    INTO v_existing_session_id
    FROM public.ai_interview_sessions AS s
    WHERE s.campaign_candidate_id = v_candidate.id
    LIMIT 1;

    IF v_existing_session_id IS NOT NULL THEN
      v_existing_count := v_existing_count + 1;

      UPDATE public.ai_interview_campaign_candidates AS cc
      SET
        session_id = v_existing_session_id,
        status = CASE
          WHEN cc.status = 'Pending'
            THEN 'Queued for Invitation'
          ELSE cc.status
        END,
        invitation_status = CASE
          WHEN cc.invitation_status = 'Not Queued'
            THEN 'Queued'
          ELSE cc.invitation_status
        END,
        updated_at = now()
      WHERE cc.id = v_candidate.id;

      INSERT INTO public.ai_interview_invitation_jobs (
        company_id,
        campaign_id,
        campaign_candidate_id,
        session_id,
        job_type,
        recipient_email,
        recipient_name,
        language,
        status,
        priority,
        attempt_count,
        max_attempts,
        available_at,
        payload
      )
      SELECT
        v_campaign.company_id,
        v_campaign.id,
        v_candidate.id,
        s.id,
        'Invitation',
        v_candidate.candidate_email,
        v_candidate.candidate_name,
        v_campaign.language,
        'Queued',
        100,
        0,
        3,
        now(),
        jsonb_build_object(
          'campaign_name', v_campaign.campaign_name,
          'candidate_name', v_candidate.candidate_name,
          'candidate_email', v_candidate.candidate_email,
          'profession',
            coalesce(
              nullif(v_candidate.profession, ''),
              v_campaign.profession
            ),
          'request_no',
            coalesce(
              nullif(v_candidate.request_no, ''),
              v_campaign.request_no
            ),
          'template_name', v_template.template_name,
          'duration_minutes',
            coalesce(v_template.duration_minutes, 15),
          'deadline', v_deadline,
          'invitation_url', s.invitation_url,
          'candidate_instructions',
            coalesce(v_template.candidate_instructions, ''),
          'final_decision_note',
            'AI recommendation only ط£آ¢أ¢â€ڑآ¬أ¢â‚¬â€Œ final decision belongs to the company.'
        )
      FROM public.ai_interview_sessions AS s
      WHERE s.id = v_existing_session_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.ai_interview_invitation_jobs AS j
          WHERE j.campaign_candidate_id = v_candidate.id
            AND j.job_type = 'Invitation'
            AND j.status IN (
              'Queued',
              'Processing',
              'Sent'
            )
        );

      IF FOUND THEN
        v_jobs_count := v_jobs_count + 1;
      END IF;

      CONTINUE;
    END IF;

    INSERT INTO public.ai_interview_sessions (
      company_id,
      template_id,
      campaign_id,
      campaign_candidate_id,
      candidate_id,
      interview_id,
      request_line_id,
      request_no,
      project_name,
      candidate_name,
      candidate_email,
      candidate_mobile,
      passport_no,
      profession,
      nationality,
      agency_name,
      language,
      interview_mode,
      invitation_url,
      status,
      scheduled_at,
      expires_at,
      consent_required,
      total_questions,
      ai_recommendation,
      review_status,
      human_decision,
      analysis_status,
      created_by,
      updated_by,
      created_at,
      updated_at
    )
    SELECT
      v_campaign.company_id,
      v_template.id,
      v_campaign.id,
      v_candidate.id,
      coalesce(v_candidate.candidate_id, ''),
      '',
      coalesce(c.request_line_id::text, ''),
      coalesce(
        nullif(v_candidate.request_no, ''),
        v_campaign.request_no,
        ''
      ),
      coalesce(
        nullif(v_campaign.project_name, ''),
        c.project,
        ''
      ),
      coalesce(
        nullif(v_candidate.candidate_name, ''),
        c.candidate_name,
        'Candidate'
      ),
      v_candidate.candidate_email,
      coalesce(
        nullif(v_candidate.candidate_mobile, ''),
        c.mobile,
        ''
      ),
      coalesce(c.passport_no, ''),
      coalesce(
        nullif(v_candidate.profession, ''),
        v_campaign.profession,
        c.profession,
        ''
      ),
      coalesce(
        nullif(v_candidate.nationality, ''),
        c.nationality,
        ''
      ),
      coalesce(
        nullif(v_candidate.agency_name, ''),
        c.agency,
        ''
      ),
      coalesce(
        nullif(v_campaign.language, ''),
        v_template.language,
        'Bilingual'
      ),
      coalesce(v_template.interview_mode, 'Voice'),
      '',
      'Invitation Pending',
      NULL,
      v_deadline,
      coalesce(v_template.require_consent, true),
      v_question_count,
      'Pending Analysis',
      'Pending Human Review',
      'Pending Company Review',
      'Pending',
      v_actor_name,
      v_actor_name,
      now(),
      now()
    FROM (SELECT 1) AS seed
    LEFT JOIN public.candidates AS c
      ON c.company_id = v_campaign.company_id
     AND c.id::text = v_candidate.candidate_id
    RETURNING
      public.ai_interview_sessions.id,
      public.ai_interview_sessions.access_token::text
    INTO v_session_id, v_access_token;

    v_invitation_url :=
      v_base_url || '?ai_interview=' || v_access_token;

    UPDATE public.ai_interview_sessions AS s
    SET
      invitation_url = v_invitation_url,
      updated_by = v_actor_name,
      updated_at = now()
    WHERE s.id = v_session_id;

    UPDATE public.ai_interview_campaign_candidates AS cc
    SET
      session_id = v_session_id,
      status = 'Queued for Invitation',
      invitation_status = 'Queued',
      analysis_status = 'Pending',
      last_error = '',
      updated_at = now()
    WHERE cc.id = v_candidate.id;

    INSERT INTO public.ai_interview_invitation_jobs (
      company_id,
      campaign_id,
      campaign_candidate_id,
      session_id,
      job_type,
      recipient_email,
      recipient_name,
      language,
      status,
      priority,
      attempt_count,
      max_attempts,
      available_at,
      payload
    )
    VALUES (
      v_campaign.company_id,
      v_campaign.id,
      v_candidate.id,
      v_session_id,
      'Invitation',
      v_candidate.candidate_email,
      v_candidate.candidate_name,
      v_campaign.language,
      'Queued',
      100,
      0,
      3,
      now(),
      jsonb_build_object(
        'campaign_name', v_campaign.campaign_name,
        'candidate_name', v_candidate.candidate_name,
        'candidate_email', v_candidate.candidate_email,
        'profession',
          coalesce(
            nullif(v_candidate.profession, ''),
            v_campaign.profession
          ),
        'request_no',
          coalesce(
            nullif(v_candidate.request_no, ''),
            v_campaign.request_no
          ),
        'template_name', v_template.template_name,
        'duration_minutes',
          coalesce(v_template.duration_minutes, 15),
        'deadline', v_deadline,
        'invitation_url', v_invitation_url,
        'candidate_instructions',
          coalesce(v_template.candidate_instructions, ''),
        'final_decision_note',
          'AI recommendation only ط£آ¢أ¢â€ڑآ¬أ¢â‚¬â€Œ final decision belongs to the company.'
      )
    );

    v_created_count := v_created_count + 1;
    v_jobs_count := v_jobs_count + 1;
  END LOOP;

  UPDATE public.ai_interview_campaigns AS c
  SET
    status = 'Active',
    launched_at = coalesce(c.launched_at, now()),
    updated_at = now()
  WHERE c.id = p_campaign_id;

  PERFORM public.refresh_ai_interview_campaign_counts(
    p_campaign_id
  );

  RETURN QUERY
  SELECT
    v_campaign.id,
    'Active'::text,
    v_valid_count,
    v_created_count,
    v_existing_count,
    v_jobs_count,
    v_invalid_count;
END;
$_$;


--
-- Name: legacy_app_login(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.legacy_app_login(p_email text, p_password text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  matched_user jsonb;
  matching_rows bigint;
begin
  if nullif(btrim(p_email), '') is null or nullif(p_password, '') is null then
    return jsonb_build_object('ok', false, 'user', null);
  end if;

  select count(*)
  into matching_rows
  from public.users as app_user
  where lower(btrim(app_user.email)) = lower(btrim(p_email))
    and app_user.password = p_password;

  if matching_rows <> 1 then
    return jsonb_build_object('ok', false, 'user', null);
  end if;

  select jsonb_build_object(
    'id', app_user.id,
    'name', app_user.name,
    'email', app_user.email,
    'role', app_user.role,
    'status', app_user.status,
    'company_id', app_user.company_id,
    'agency_id', app_user.agency_id,
    'agency_name', app_user.agency_name,
    'auth_user_id', app_user.auth_user_id,
    'created_at', app_user.created_at
  )
  into matched_user
  from public.users as app_user
  where lower(btrim(app_user.email)) = lower(btrim(p_email))
    and app_user.password = p_password
    and app_user.auth_user_id is null
    and app_user.role not in (
      'Platform Owner',
      'Platform Accounts User',
      'Platform Support User'
    )
    and app_user.status = 'Active'
    and app_user.is_active is true
    and (
      app_user.company_id is null
      or exists (
        select 1
        from public.companies as company
        where company.id = app_user.company_id
          and company.status = 'Active'
      )
    )
    and (
      app_user.role <> 'Agency'
      or (
        app_user.agency_id is not null
        and exists (
          select 1
          from public.agencies as agency
          where agency.id = app_user.agency_id
            and agency.status = 'Active'
        )
      )
    );

  if matched_user is null then
    return jsonb_build_object('ok', false, 'user', null);
  end if;

  return jsonb_build_object('ok', true, 'user', matched_user);
end;
$$;


--
-- Name: list_manageable_app_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_manageable_app_users() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id public.users.id%type;
  actor_role public.users.role%type;
  actor_company_id public.users.company_id%type;
  linked_rows bigint;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select count(*)
  into linked_rows
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if linked_rows <> 1 then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select app_user.id, app_user.role, app_user.company_id
  into actor_id, actor_role, actor_company_id
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active'
    and app_user.is_active is true
    and (
      app_user.company_id is null
      or exists (
        select 1
        from public.companies as company
        where company.id = app_user.company_id
          and company.status = 'Active'
      )
    )
    and (
      app_user.role not in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
      or app_user.company_id is null
    );

  if actor_id is null or actor_role not in (
    'Platform Owner',
    'Platform Accounts User',
    'Company Admin',
    'Admin'
  ) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if actor_role in ('Platform Owner', 'Platform Accounts User') then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', managed_user.id,
          'name', managed_user.name,
          'email', managed_user.email,
          'role', managed_user.role,
          'status', managed_user.status,
          'company_id', managed_user.company_id,
          'agency_id', managed_user.agency_id,
          'agency_name', managed_user.agency_name,
          'auth_user_id', managed_user.auth_user_id,
          'created_at', managed_user.created_at
        )
        order by managed_user.created_at desc nulls last, managed_user.id
      ),
      '[]'::jsonb
    )
    into result
    from public.users as managed_user;
  else
    if actor_company_id is null then
      raise exception 'access denied' using errcode = '42501';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', managed_user.id,
          'name', managed_user.name,
          'email', managed_user.email,
          'role', managed_user.role,
          'status', managed_user.status,
          'company_id', managed_user.company_id,
          'agency_id', managed_user.agency_id,
          'agency_name', managed_user.agency_name,
          'auth_user_id', managed_user.auth_user_id,
          'created_at', managed_user.created_at
        )
        order by managed_user.created_at desc nulls last, managed_user.id
      ),
      '[]'::jsonb
    )
    into result
    from public.users as managed_user
    where managed_user.company_id = actor_company_id;
  end if;

  return coalesce(result, '[]'::jsonb);
end;
$$;


--
-- Name: log_system_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_system_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_data jsonb := '{}'::jsonb;
  v_changed_fields jsonb := '[]'::jsonb;

  v_company_id uuid := null;
  v_company_text text := '';
  v_request_no text := '';
  v_record_id text := '';
  v_record_label text := '';

  v_actor_name text := '';
  v_actor_email text := '';
  v_actor_role text := '';

  v_action_type text := '';
begin
  if TG_OP in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(OLD);
  end if;

  if TG_OP in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(NEW);
  end if;

  v_data := case when TG_OP = 'DELETE' then v_old else v_new end;

  v_company_text := nullif(coalesce(v_data->>'company_id', ''), '');

  if v_company_text is not null then
    begin
      v_company_id := v_company_text::uuid;
    exception when others then
      v_company_id := null;
    end;
  end if;

  v_request_no := coalesce(v_data->>'request_no', '');
  v_record_id := coalesce(v_data->>'id', '');

  v_record_label := coalesce(
    v_data->>'request_no',
    v_data->>'candidate_name',
    v_data->>'visa_no',
    v_data->>'authorization_no',
    v_data->>'employee_name',
    v_data->>'agreement_no',
    v_data->>'penalty_no',
    v_data->>'name',
    v_record_id,
    ''
  );

  v_actor_name := coalesce(
    nullif(v_new->>'updated_by_name', ''),
    nullif(v_new->>'created_by_name', ''),
    nullif(v_new->>'decision_by_name', ''),
    nullif(v_new->>'final_decision_by_name', ''),
    nullif(v_new->>'updated_by', ''),
    nullif(v_new->>'created_by', ''),
    nullif(v_old->>'updated_by_name', ''),
    nullif(v_old->>'created_by_name', ''),
    nullif(current_setting('request.jwt.claim.email', true), ''),
    'System'
  );

  v_actor_email := coalesce(
    nullif(v_new->>'updated_by_email', ''),
    nullif(v_new->>'created_by_email', ''),
    nullif(v_new->>'decision_by_email', ''),
    nullif(v_new->>'final_decision_by_email', ''),
    nullif(v_old->>'updated_by_email', ''),
    nullif(v_old->>'created_by_email', ''),
    nullif(current_setting('request.jwt.claim.email', true), ''),
    ''
  );

  v_actor_role := coalesce(
    nullif(v_new->>'updated_by_role', ''),
    nullif(v_new->>'created_by_role', ''),
    nullif(v_new->>'decision_by_role', ''),
    nullif(v_new->>'final_decision_by_role', ''),
    nullif(v_old->>'updated_by_role', ''),
    nullif(v_old->>'created_by_role', ''),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    'System'
  );

  v_action_type := case TG_OP
    when 'INSERT' then 'Created'
    when 'UPDATE' then 'Updated'
    when 'DELETE' then 'Deleted'
    else TG_OP
  end;

  if TG_OP = 'UPDATE' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'field', field_name,
          'old', v_old -> field_name,
          'new', v_new -> field_name
        )
      ),
      '[]'::jsonb
    )
    into v_changed_fields
    from (
      select jsonb_object_keys(v_old) as field_name
      union
      select jsonb_object_keys(v_new) as field_name
    ) fields
    where (v_old -> field_name) is distinct from (v_new -> field_name)
      and field_name not in (
        'updated_at',
        'created_by_name',
        'created_by_email',
        'created_by_role',
        'updated_by_name',
        'updated_by_email',
        'updated_by_role'
      );
  end if;

  insert into public.system_activity_logs (
    company_id,
    request_no,
    module_name,
    record_id,
    record_label,
    action_type,
    action_title,
    old_values,
    new_values,
    changed_fields,
    changed_by_name,
    changed_by_email,
    changed_by_role,
    notes,
    source,
    created_at
  )
  values (
    v_company_id,
    v_request_no,
    coalesce(TG_ARGV[0], TG_TABLE_NAME),
    v_record_id,
    v_record_label,
    v_action_type,
    v_action_type || ' - ' || coalesce(TG_ARGV[0], TG_TABLE_NAME),
    v_old,
    v_new,
    v_changed_fields,
    v_actor_name,
    v_actor_email,
    v_actor_role,
    'Auto captured from database trigger',
    'DB Trigger',
    now()
  );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$$;


--
-- Name: next_request_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_request_no() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_request_no text;
begin
  loop
    v_request_no :=
      'REQ-' ||
      to_char(now() at time zone 'Asia/Riyadh', 'YYYY') ||
      '-' ||
      lpad(nextval('public.request_no_seq')::text, 4, '0');

    exit when not exists (
      select 1
      from public.requests r
      where r.request_no = v_request_no
    );
  end loop;

  return v_request_no;
end;
$$;


--
-- Name: publish_ai_interview_template_version(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_ai_interview_template_version(p_template_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_id uuid;
begin
  select template_group_id
  into v_group_id
  from public.ai_interview_templates
  where id = p_template_id;

  if v_group_id is null then
    raise exception 'Template not found';
  end if;

  update public.ai_interview_templates
  set
    status = 'Archived',
    is_active = false,
    is_current_version = false,
    updated_at = now()
  where template_group_id = v_group_id;

  update public.ai_interview_templates
  set
    status = 'Active',
    approval_status = 'Approved',
    is_active = true,
    is_current_version = true,
    approved_at = now(),
    updated_at = now()
  where id = p_template_id;
end;
$$;


--
-- Name: queue_ai_interview_analysis(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_company_id uuid;
  v_session_status text;
  v_job_id uuid;
BEGIN
  SELECT company_id, status
  INTO v_company_id, v_session_status
  FROM public.ai_interview_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI interview session % was not found', p_session_id;
  END IF;

  IF v_session_status <> 'Completed' THEN
    RAISE EXCEPTION
      'AI interview session % is not completed. Current status: %',
      p_session_id,
      v_session_status;
  END IF;

  SELECT id
  INTO v_job_id
  FROM public.ai_interview_analysis_jobs
  WHERE session_id = p_session_id
    AND status IN ('Queued', 'Processing')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_job_id IS NULL THEN
    INSERT INTO public.ai_interview_analysis_jobs (
      company_id,
      session_id,
      status,
      payload
    )
    VALUES (
      v_company_id,
      p_session_id,
      'Queued',
      jsonb_build_object('queued_reason', 'Interview Completed')
    )
    RETURNING id INTO v_job_id;
  END IF;

  UPDATE public.ai_interview_sessions
  SET
    analysis_status = 'Queued',
    analysis_last_queued_at = now(),
    analysis_error = '',
    ai_recommendation = CASE
      WHEN coalesce(ai_recommendation, '') = '' THEN 'Pending Analysis'
      ELSE ai_recommendation
    END,
    updated_at = now()
  WHERE id = p_session_id;

  RETURN v_job_id;
END;
$$;


--
-- Name: refresh_ai_interview_campaign_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_ai_interview_campaign_counts(p_campaign_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.ai_interview_campaigns AS c
  SET
    total_candidates = x.total_candidates,
    valid_candidates = x.valid_candidates,
    invitation_queued_count = x.invitation_queued_count,
    invitation_sent_count = x.invitation_sent_count,
    opened_count = x.opened_count,
    in_progress_count = x.in_progress_count,
    completed_count = x.completed_count,
    analyzed_count = x.analyzed_count,
    needs_review_count = x.needs_review_count,
    shortlisted_count = x.shortlisted_count,
    rejected_count = x.rejected_count,
    updated_at = now()
  FROM (
    SELECT
      cc.campaign_id AS target_campaign_id,
      count(*)::integer AS total_candidates,
      count(*) FILTER (
        WHERE cc.validation_status = 'Valid'
      )::integer AS valid_candidates,
      count(*) FILTER (
        WHERE cc.invitation_status IN ('Queued', 'Sending')
      )::integer AS invitation_queued_count,
      count(*) FILTER (
        WHERE cc.invitation_status IN ('Sent', 'Delivered', 'Opened')
      )::integer AS invitation_sent_count,
      count(*) FILTER (
        WHERE cc.status = 'Opened'
           OR cc.invitation_status = 'Opened'
      )::integer AS opened_count,
      count(*) FILTER (
        WHERE cc.status = 'In Progress'
      )::integer AS in_progress_count,
      count(*) FILTER (
        WHERE cc.status IN (
          'Completed',
          'Queued for Analysis',
          'Transcribing',
          'Analyzing',
          'Review Ready',
          'Needs Human Review',
          'Human Reviewed'
        )
      )::integer AS completed_count,
      count(*) FILTER (
        WHERE cc.analysis_status = 'Completed'
      )::integer AS analyzed_count,
      count(*) FILTER (
        WHERE cc.analysis_status = 'Needs Review'
           OR cc.status = 'Needs Human Review'
      )::integer AS needs_review_count,
      count(*) FILTER (
        WHERE cc.human_decision IN (
          'Shortlisted',
          'Selected',
          'Technical Interview Required'
        )
      )::integer AS shortlisted_count,
      count(*) FILTER (
        WHERE cc.human_decision = 'Rejected'
      )::integer AS rejected_count
    FROM public.ai_interview_campaign_candidates AS cc
    WHERE cc.campaign_id = p_campaign_id
    GROUP BY cc.campaign_id
  ) AS x
  WHERE c.id = x.target_campaign_id;

  IF NOT FOUND THEN
    UPDATE public.ai_interview_campaigns AS c
    SET
      total_candidates = 0,
      valid_candidates = 0,
      invitation_queued_count = 0,
      invitation_sent_count = 0,
      opened_count = 0,
      in_progress_count = 0,
      completed_count = 0,
      analyzed_count = 0,
      needs_review_count = 0,
      shortlisted_count = 0,
      rejected_count = 0,
      updated_at = now()
    WHERE c.id = p_campaign_id;
  END IF;
END;
$$;


--
-- Name: remove_candidates_from_ai_interview_campaign(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_campaign public.ai_interview_campaigns%ROWTYPE;
  v_deleted integer := 0;
BEGIN
  SELECT *
  INTO v_campaign
  FROM public.ai_interview_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI interview campaign % was not found.', p_campaign_id;
  END IF;

  IF v_campaign.status NOT IN ('Draft', 'Ready', 'Paused') THEN
    RAISE EXCEPTION
      'Candidates cannot be removed while campaign status is %.',
      v_campaign.status;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND lower(coalesce(u.status, 'Active')) = 'active'
      AND (
        u.company_id = v_campaign.company_id
        OR lower(coalesce(u.role, '')) = 'platform owner'
      )
  ) THEN
    RAISE EXCEPTION 'You do not have access to this campaign.';
  END IF;

  DELETE FROM public.ai_interview_campaign_candidates
  WHERE campaign_id = p_campaign_id
    AND id = ANY(p_campaign_candidate_ids)
    AND session_id IS NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM public.refresh_ai_interview_campaign_counts(p_campaign_id);

  RETURN v_deleted;
END;
$$;


--
-- Name: revalidate_ai_interview_campaign_candidates(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) RETURNS TABLE(total_count integer, valid_count integer, invalid_count integer, duplicate_count integer, ready_to_launch boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_campaign public.ai_interview_campaigns%ROWTYPE;
BEGIN
  SELECT c.*
  INTO v_campaign
  FROM public.ai_interview_campaigns AS c
  WHERE c.id = p_campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'AI interview campaign % was not found.',
      p_campaign_id;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.users AS u
    WHERE u.auth_user_id = auth.uid()
      AND lower(coalesce(u.status, 'Active')) = 'active'
      AND (
        u.company_id = v_campaign.company_id
        OR lower(coalesce(u.role, '')) = 'platform owner'
      )
  ) THEN
    RAISE EXCEPTION
      'You do not have access to this campaign.';
  END IF;

  UPDATE public.ai_interview_campaign_candidates AS cc
  SET
    candidate_email = lower(btrim(coalesce(cc.candidate_email, ''))),
    validation_status = CASE
      WHEN btrim(coalesce(cc.candidate_email, '')) = ''
        THEN 'Invalid'
      WHEN btrim(cc.candidate_email)
        !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
        THEN 'Invalid'
      ELSE 'Valid'
    END,
    validation_error = CASE
      WHEN btrim(coalesce(cc.candidate_email, '')) = ''
        THEN 'Candidate email is missing.'
      WHEN btrim(cc.candidate_email)
        !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
        THEN 'Candidate email format is invalid.'
      ELSE ''
    END,
    updated_at = now()
  WHERE cc.campaign_id = p_campaign_id
    AND cc.status IN (
      'Pending',
      'Failed',
      'Queued for Invitation'
    );

  WITH ranked_candidates AS (
    SELECT
      cc.id AS campaign_candidate_id,
      row_number() OVER (
        PARTITION BY
          cc.campaign_id,
          lower(btrim(cc.candidate_email))
        ORDER BY cc.created_at, cc.id
      ) AS row_no
    FROM public.ai_interview_campaign_candidates AS cc
    WHERE cc.campaign_id = p_campaign_id
      AND btrim(coalesce(cc.candidate_email, '')) <> ''
  )
  UPDATE public.ai_interview_campaign_candidates AS target
  SET
    validation_status = 'Duplicate',
    validation_error =
      'Duplicate candidate email inside this campaign.',
    updated_at = now()
  FROM ranked_candidates AS ranked
  WHERE target.id = ranked.campaign_candidate_id
    AND ranked.row_no > 1;

  PERFORM public.refresh_ai_interview_campaign_counts(
    p_campaign_id
  );

  UPDATE public.ai_interview_campaigns AS c
  SET
    status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.ai_interview_campaign_candidates AS cc
        WHERE cc.campaign_id = p_campaign_id
          AND cc.validation_status = 'Valid'
      )
      THEN 'Ready'
      ELSE 'Draft'
    END,
    updated_at = now()
  WHERE c.id = p_campaign_id
    AND c.status IN ('Draft', 'Ready');

  RETURN QUERY
  SELECT
    count(*)::integer AS total_count,
    count(*) FILTER (
      WHERE cc.validation_status = 'Valid'
    )::integer AS valid_count,
    count(*) FILTER (
      WHERE cc.validation_status = 'Invalid'
    )::integer AS invalid_count,
    count(*) FILTER (
      WHERE cc.validation_status = 'Duplicate'
    )::integer AS duplicate_count,
    (
      count(*) FILTER (
        WHERE cc.validation_status = 'Valid'
      ) > 0
      AND count(*) FILTER (
        WHERE cc.validation_status IN (
          'Invalid',
          'Duplicate'
        )
      ) = 0
    ) AS ready_to_launch
  FROM public.ai_interview_campaign_candidates AS cc
  WHERE cc.campaign_id = p_campaign_id;
END;
$_$;


--
-- Name: set_ai_interview_campaign_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_ai_interview_campaign_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: set_ai_interview_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_ai_interview_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: set_onboarding_validations_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_onboarding_validations_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: sync_ai_interview_session_to_campaign(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_ai_interview_session_to_campaign() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_campaign_candidate_id uuid;
  v_candidate_status text;
  v_invitation_status text;
  v_analysis_status text;
BEGIN
  v_campaign_candidate_id := coalesce(
    NEW.campaign_candidate_id,
    (
      SELECT cc.id
      FROM public.ai_interview_campaign_candidates cc
      WHERE cc.session_id = NEW.id
      LIMIT 1
    )
  );

  IF v_campaign_candidate_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_invitation_status := CASE
    WHEN NEW.status IN ('Invited') THEN 'Sent'
    WHEN NEW.status IN ('Opened', 'Consent Pending', 'Ready', 'In Progress', 'Completed') THEN 'Opened'
    WHEN NEW.status IN ('Cancelled') THEN 'Cancelled'
    WHEN NEW.status IN ('Expired') THEN 'Failed'
    ELSE NULL
  END;

  v_analysis_status := CASE
    WHEN NEW.analysis_status IN ('Pending', 'Queued', 'Transcribing', 'Analyzing', 'Completed', 'Needs Review', 'Failed')
      THEN NEW.analysis_status
    ELSE 'Pending'
  END;

  v_candidate_status := CASE
    WHEN coalesce(NEW.human_decision, 'Pending Company Review') <> 'Pending Company Review'
      THEN 'Human Reviewed'
    WHEN v_analysis_status = 'Completed' THEN 'Review Ready'
    WHEN v_analysis_status = 'Needs Review' THEN 'Needs Human Review'
    WHEN v_analysis_status = 'Failed' THEN 'Failed'
    WHEN v_analysis_status = 'Analyzing' THEN 'Analyzing'
    WHEN v_analysis_status = 'Transcribing' THEN 'Transcribing'
    WHEN NEW.status = 'Completed' THEN 'Queued for Analysis'
    WHEN NEW.status = 'In Progress' THEN 'In Progress'
    WHEN NEW.status IN ('Opened', 'Consent Pending', 'Ready') THEN 'Opened'
    WHEN NEW.status = 'Invited' THEN 'Invitation Sent'
    WHEN NEW.status = 'Expired' THEN 'Expired'
    WHEN NEW.status = 'Cancelled' THEN 'Cancelled'
    ELSE 'Queued for Invitation'
  END;

  UPDATE public.ai_interview_campaign_candidates
  SET
    session_id = NEW.id,
    status = v_candidate_status,
    invitation_status = coalesce(v_invitation_status, invitation_status),
    analysis_status = v_analysis_status,
    invited_at = coalesce(invited_at, NEW.invitation_sent_at),
    opened_at = coalesce(opened_at, NEW.first_opened_at),
    started_at = coalesce(started_at, NEW.started_at),
    completed_at = coalesce(completed_at, NEW.completed_at),
    analyzed_at = coalesce(analyzed_at, NEW.analysis_completed_at),
    overall_score = NEW.overall_score,
    ai_recommendation = coalesce(NEW.ai_recommendation, ai_recommendation),
    human_decision = coalesce(NEW.human_decision, human_decision),
    human_reviewed_at = coalesce(
      human_reviewed_at,
      CASE
        WHEN coalesce(NEW.human_decision, 'Pending Company Review') <> 'Pending Company Review'
          THEN coalesce(NEW.updated_at, now())
        ELSE NULL
      END
    ),
    last_error = coalesce(NEW.analysis_error, ''),
    updated_at = now()
  WHERE id = v_campaign_candidate_id;

  RETURN NEW;
END;
$$;


--
-- Name: talent_after_candidate_profile_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.talent_after_candidate_profile_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  perform public.talent_refresh_profile_completeness(new.id);
  return new;
end;
$$;


--
-- Name: talent_after_profile_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.talent_after_profile_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_candidate_id uuid;
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'talent_candidates' then
    v_candidate_id := coalesce(new.id, old.id);
  elsif tg_op = 'DELETE' then
    v_candidate_id := old.candidate_id;
  else
    v_candidate_id := new.candidate_id;
  end if;

  perform public.talent_refresh_profile_completeness(v_candidate_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


--
-- Name: talent_calculate_profile_completeness(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.talent_calculate_profile_completeness(p_candidate_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with c as (
    select * from public.talent_candidates where id = p_candidate_id
  ), required_checks as (
    select
      (case when nullif(trim(full_name), '') is not null then 8 else 0 end) +
      (case when nullif(trim(email), '') is not null then 5 else 0 end) +
      (case when nullif(trim(phone), '') is not null then 7 else 0 end) +
      (case when nullif(trim(nationality), '') is not null then 6 else 0 end) +
      (case when nullif(trim(country_of_residence), '') is not null then 6 else 0 end) +
      (case when nullif(trim(city), '') is not null then 5 else 0 end) +
      (case when nullif(trim(profession), '') is not null then 8 else 0 end) +
      (case when nullif(trim(current_job_title), '') is not null then 5 else 0 end) +
      (case when years_experience is not null then 5 else 0 end) +
      (case when expected_salary is not null then 5 else 0 end) +
      (case when jsonb_array_length(coalesce(languages, '[]'::jsonb)) > 0 then 5 else 0 end) +
      (case when nullif(trim(headline), '') is not null then 5 else 0 end) +
      (case when nullif(trim(professional_summary), '') is not null then 7 else 0 end) +
      (case when exists(
        select 1 from public.talent_candidate_documents d
        where d.candidate_id = p_candidate_id
          and d.document_type = 'CV'
          and d.is_primary = true
      ) then 10 else 0 end) +
      (case when exists(
        select 1 from public.talent_candidate_consents x
        where x.candidate_id = p_candidate_id
          and x.consent_type = 'Platform Terms'
          and x.is_granted = true
      ) then 3 else 0 end) +
      (case when exists(
        select 1 from public.talent_candidate_consents x
        where x.candidate_id = p_candidate_id
          and x.consent_type = 'Privacy Policy'
          and x.is_granted = true
      ) then 3 else 0 end) +
      (case when exists(
        select 1 from public.talent_candidate_consents x
        where x.candidate_id = p_candidate_id
          and x.consent_type = 'AI CV Analysis'
          and x.is_granted = true
      ) then 3 else 0 end) +
      (case when marketplace_status in ('Submitted','Under Review','Approved') then 4 else 0 end)
      as score
    from c
  )
  select least(100, greatest(0, coalesce(score, 0)))::integer from required_checks;
$$;


--
-- Name: talent_guard_managed_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.talent_guard_managed_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if current_setting('visaflow.talent_internal_update', true) = '1'
     or public.talent_is_privileged_actor() then
    return new;
  end if;

  if tg_table_name = 'talent_candidates' then
    if tg_op = 'INSERT' then
      new.public_reference := coalesce(
        nullif(new.public_reference, ''),
        'VF-TAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
      );
      new.marketplace_status := 'Draft';
      new.ai_cv_status := 'Not Uploaded';
      new.ai_cv_summary := '{}'::jsonb;
      new.ai_interview_status := 'Not Invited';
      new.latest_ai_interview_session_id := null;
      new.latest_ai_interview_score := null;
      new.latest_ai_recommendation := null;
      new.profile_completeness := 0;
      new.is_verified := false;
      new.verified_at := null;
      new.published_at := null;
    else
      new.auth_user_id := old.auth_user_id;
      new.public_reference := old.public_reference;

      if new.marketplace_status not in ('Draft', 'Submitted') then
        new.marketplace_status := old.marketplace_status;
      end if;

      new.ai_cv_summary := old.ai_cv_summary;
      new.latest_ai_interview_session_id := old.latest_ai_interview_session_id;
      new.latest_ai_interview_score := old.latest_ai_interview_score;
      new.latest_ai_recommendation := old.latest_ai_recommendation;
      new.profile_completeness := old.profile_completeness;
      new.is_verified := old.is_verified;
      new.verified_at := old.verified_at;
      new.published_at := old.published_at;
    end if;

  elsif tg_table_name = 'talent_candidate_documents' then
    if tg_op = 'INSERT' then
      new.parse_status := 'Pending';
      new.extracted_text := null;
      new.parsed_data := '{}'::jsonb;
      new.parse_error := null;
      new.processed_at := null;
    else
      new.parse_status := old.parse_status;
      new.extracted_text := old.extracted_text;
      new.parsed_data := old.parsed_data;
      new.parse_error := old.parse_error;
      new.processed_at := old.processed_at;
    end if;

  elsif tg_table_name = 'talent_candidate_skills' then
    new.source := 'Candidate';
    new.confidence := null;
    new.is_verified := false;

  elsif tg_table_name in ('talent_candidate_experience', 'talent_candidate_education') then
    new.source := 'Candidate';

  elsif tg_table_name = 'talent_candidate_certifications' then
    new.source := 'Candidate';
    new.is_verified := false;
  end if;

  return new;
end;
$$;


--
-- Name: talent_is_privileged_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.talent_is_privileged_actor() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or exists (
      select 1
      from public.users u
      where u.auth_user_id = auth.uid()
        and u.role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
        and coalesce(u.status, 'Active') = 'Active'
    );
$$;


--
-- Name: talent_refresh_profile_completeness(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.talent_refresh_profile_completeness(p_candidate_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform set_config('visaflow.talent_internal_update', '1', true);

  update public.talent_candidates
  set profile_completeness = public.talent_calculate_profile_completeness(p_candidate_id),
      updated_at = now()
  where id = p_candidate_id;

  perform set_config('visaflow.talent_internal_update', '0', true);
exception
  when others then
    perform set_config('visaflow.talent_internal_update', '0', true);
    raise;
end;
$$;


--
-- Name: talent_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.talent_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: trg_refresh_ai_interview_campaign_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_refresh_ai_interview_campaign_counts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_campaign_id uuid;
BEGIN
  v_campaign_id := COALESCE(NEW.campaign_id, OLD.campaign_id);
  PERFORM public.refresh_ai_interview_campaign_counts(v_campaign_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: agencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text,
    country text,
    status text,
    contact_person text,
    email text,
    phone text,
    updated_at timestamp with time zone DEFAULT now(),
    company_id uuid
);


--
-- Name: agency_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agreement_no text,
    agency_name text NOT NULL,
    signed_by_company text,
    signed_by_agency text,
    company_signature text,
    agency_signature text,
    status text DEFAULT 'Draft'::text,
    sla_days integer DEFAULT 60,
    effective_date date,
    expiry_date date,
    terms text,
    created_at timestamp without time zone DEFAULT now(),
    company_id uuid,
    updated_at timestamp with time zone DEFAULT now(),
    template_type text DEFAULT 'Standard Recruitment SLA'::text,
    policy_name text DEFAULT 'Standard Recruitment Agency Policy'::text,
    response_sla_hours integer DEFAULT 24,
    update_frequency_days integer DEFAULT 7,
    delay_penalty_type text DEFAULT 'Fixed Amount'::text,
    delay_penalty_amount numeric DEFAULT 0,
    delay_penalty_after_days integer DEFAULT 7,
    financial_guarantee_required text DEFAULT 'No'::text,
    financial_guarantee_amount numeric,
    replacement_guarantee_days integer DEFAULT 90,
    payment_terms text,
    cancellation_terms text,
    sent_to_agency_at timestamp with time zone,
    agency_accepted_at timestamp with time zone,
    agency_accepted_by text,
    agency_accepted_email text,
    agency_rejected_at timestamp with time zone,
    agency_rejection_reason text
);


--
-- Name: agency_client_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_client_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agency_id uuid,
    agency_name text,
    user_id uuid,
    user_email text,
    company_id uuid NOT NULL,
    company_name text NOT NULL,
    role text DEFAULT 'Coordinator'::text NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agency_company_user_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_company_user_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    agency_id uuid NOT NULL,
    user_id bigint NOT NULL,
    role text DEFAULT 'Agency User'::text NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    can_view_requests boolean DEFAULT true NOT NULL,
    can_upload_candidates boolean DEFAULT true NOT NULL,
    can_update_candidates boolean DEFAULT true NOT NULL,
    can_view_interviews boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agency_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agency_id uuid NOT NULL,
    user_id bigint NOT NULL,
    role text DEFAULT 'Agency User'::text NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agency_penalties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_penalties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    penalty_no text NOT NULL,
    agreement_id uuid,
    agreement_no text,
    agency_id uuid,
    agency_name text NOT NULL,
    candidate_id text,
    candidate_name text,
    request_no text,
    profession text,
    project text,
    status text DEFAULT 'Pending Review'::text NOT NULL,
    sla_days integer DEFAULT 60,
    actual_days integer DEFAULT 0,
    delay_days integer DEFAULT 0,
    grace_days integer DEFAULT 0,
    penalty_days integer DEFAULT 0,
    penalty_type text DEFAULT 'Fixed Amount'::text,
    penalty_rate numeric DEFAULT 0,
    calculated_amount numeric DEFAULT 0,
    approved_amount numeric,
    decision_notes text,
    decision_by text,
    decision_role text,
    decision_at timestamp with time zone,
    sent_to_agency_at timestamp with time zone,
    agency_justification text,
    agency_justification_by text,
    agency_justification_email text,
    agency_justification_at timestamp with time zone,
    final_decision text,
    final_decision_by text,
    final_decision_role text,
    final_decision_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: agency_score_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_score_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    agency_id uuid NOT NULL,
    sla_score numeric(5,2) DEFAULT 0,
    quality_score numeric(5,2) DEFAULT 0,
    response_score numeric(5,2) DEFAULT 0,
    mobilization_score numeric(5,2) DEFAULT 0,
    update_score numeric(5,2) DEFAULT 0,
    agreement_score numeric(5,2) DEFAULT 0,
    total_score numeric(5,2) DEFAULT 0,
    rank character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    agreement_sla_days integer,
    update_frequency_days integer,
    delayed_candidates integer DEFAULT 0,
    average_delay_days numeric DEFAULT 0,
    penalty_exposure numeric DEFAULT 0,
    agreement_no text
);


--
-- Name: agency_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agency_name text NOT NULL,
    sla_score numeric DEFAULT 0,
    update_score numeric DEFAULT 0,
    quality_score numeric DEFAULT 0,
    arrival_score numeric DEFAULT 0,
    total_score numeric DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now(),
    company_id uuid,
    agreement_sla_days integer,
    update_frequency_days integer,
    delayed_candidates integer DEFAULT 0,
    average_delay_days numeric DEFAULT 0,
    penalty_exposure numeric DEFAULT 0,
    agreement_no text
);


--
-- Name: ai_agent_action_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_action_locks (
    company_id uuid NOT NULL,
    action_key text NOT NULL,
    action_type text NOT NULL,
    related_table text,
    related_id text,
    agency_id uuid,
    status text DEFAULT 'running'::text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    locked_until timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    last_executed_at timestamp with time zone,
    last_error text,
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_agent_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    run_id uuid DEFAULT gen_random_uuid(),
    action_type text NOT NULL,
    action_key text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    actor text DEFAULT 'AI_AGENT'::text NOT NULL,
    target_table text,
    target_id text,
    agency_id uuid,
    agency_name text,
    request_no text,
    title text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_agent_hourly_activity; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ai_agent_hourly_activity AS
 SELECT company_id,
    date_trunc('hour'::text, created_at) AS activity_hour,
    action_type,
    status,
    count(*) AS action_count
   FROM public.ai_agent_audit_logs
  GROUP BY company_id, (date_trunc('hour'::text, created_at)), action_type, status;


--
-- Name: ai_agent_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    job_key text NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    priority integer DEFAULT 50 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    requested_by uuid,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_until timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    worker_run_id uuid
);


--
-- Name: ai_agent_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    mode text DEFAULT 'auto_notify_manager'::text NOT NULL,
    auto_manager_approval boolean DEFAULT true NOT NULL,
    auto_followup_agencies boolean DEFAULT false NOT NULL,
    allow_auto_agency_emails boolean DEFAULT false NOT NULL,
    run_in_background boolean DEFAULT true NOT NULL,
    client_auto_enabled boolean DEFAULT false NOT NULL,
    manager_approval_email text,
    agency_reminder_after_days integer DEFAULT 3 NOT NULL,
    escalation_after_days integer DEFAULT 7 NOT NULL,
    daily_brief_enabled boolean DEFAULT true NOT NULL,
    daily_brief_time text DEFAULT '08:00'::text NOT NULL,
    max_auto_actions_per_run integer DEFAULT 5 NOT NULL,
    cooldown_minutes integer DEFAULT 60 NOT NULL,
    max_actions_per_hour integer DEFAULT 20 NOT NULL,
    max_retry_attempts integer DEFAULT 3 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_agent_worker_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_worker_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    company_id uuid,
    mode text,
    status text DEFAULT 'started'::text NOT NULL,
    processed_count integer DEFAULT 0 NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: ai_interview_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    session_id uuid NOT NULL,
    question_id uuid,
    question_order integer DEFAULT 1 NOT NULL,
    question_text_snapshot text NOT NULL,
    question_type text DEFAULT 'Open Question'::text NOT NULL,
    competency text DEFAULT 'General'::text NOT NULL,
    asked_at timestamp with time zone,
    answer_started_at timestamp with time zone,
    answer_completed_at timestamp with time zone,
    answer_text text DEFAULT ''::text NOT NULL,
    answer_language text DEFAULT ''::text NOT NULL,
    audio_storage_path text DEFAULT ''::text NOT NULL,
    audio_duration_seconds integer DEFAULT 0 NOT NULL,
    transcription_status text DEFAULT 'Pending'::text NOT NULL,
    transcription_confidence numeric(5,2),
    ai_score numeric(5,2),
    ai_feedback text DEFAULT ''::text NOT NULL,
    ai_reasoning text DEFAULT ''::text NOT NULL,
    matched_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    missing_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    strengths jsonb DEFAULT '[]'::jsonb NOT NULL,
    concerns jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    follow_up_question text DEFAULT ''::text NOT NULL,
    follow_up_answer text DEFAULT ''::text NOT NULL,
    follow_up_audio_storage_path text DEFAULT ''::text NOT NULL,
    answer_status text DEFAULT 'Pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    detected_language text DEFAULT ''::text NOT NULL,
    transcription_model text DEFAULT ''::text NOT NULL,
    analysis_model text DEFAULT ''::text NOT NULL,
    transcribed_at timestamp with time zone,
    analyzed_at timestamp with time zone,
    analysis_error text DEFAULT ''::text NOT NULL,
    video_storage_path text DEFAULT ''::text NOT NULL,
    video_duration_seconds integer DEFAULT 0 NOT NULL,
    video_mime_type text DEFAULT ''::text NOT NULL,
    camera_active_during_answer boolean DEFAULT false NOT NULL,
    video_upload_status text DEFAULT 'Not Required'::text NOT NULL,
    video_upload_error text DEFAULT ''::text NOT NULL,
    CONSTRAINT ai_interview_answers_ai_score_check CHECK (((ai_score IS NULL) OR ((ai_score >= (0)::numeric) AND (ai_score <= (100)::numeric)))),
    CONSTRAINT ai_interview_answers_answer_status_check CHECK ((answer_status = ANY (ARRAY['Pending'::text, 'Answered'::text, 'Skipped'::text, 'No Audio'::text, 'Processing'::text, 'Analyzed'::text, 'Failed'::text]))),
    CONSTRAINT ai_interview_answers_transcription_confidence_check CHECK (((transcription_confidence IS NULL) OR ((transcription_confidence >= (0)::numeric) AND (transcription_confidence <= (100)::numeric)))),
    CONSTRAINT ai_interview_answers_transcription_status_check CHECK ((transcription_status = ANY (ARRAY['Pending'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text, 'Not Required'::text]))),
    CONSTRAINT ai_interview_answers_video_duration_check CHECK ((video_duration_seconds >= 0)),
    CONSTRAINT ai_interview_answers_video_upload_status_check CHECK ((video_upload_status = ANY (ARRAY['Not Required'::text, 'Pending'::text, 'Uploading'::text, 'Completed'::text, 'Failed'::text])))
);


--
-- Name: ai_interview_campaign_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_campaign_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    candidate_id text,
    session_id uuid,
    candidate_name text DEFAULT ''::text NOT NULL,
    candidate_email text DEFAULT ''::text NOT NULL,
    candidate_mobile text DEFAULT ''::text NOT NULL,
    profession text DEFAULT ''::text NOT NULL,
    nationality text DEFAULT ''::text NOT NULL,
    agency_name text DEFAULT ''::text NOT NULL,
    request_no text DEFAULT ''::text NOT NULL,
    validation_status text DEFAULT 'Pending'::text NOT NULL,
    validation_error text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    invitation_status text DEFAULT 'Not Queued'::text NOT NULL,
    analysis_status text DEFAULT 'Pending'::text NOT NULL,
    overall_score numeric(5,2),
    ai_recommendation text DEFAULT 'Pending Analysis'::text NOT NULL,
    human_decision text DEFAULT 'Pending Company Review'::text NOT NULL,
    rank_position integer,
    reminder_count integer DEFAULT 0 NOT NULL,
    last_reminder_at timestamp with time zone,
    invited_at timestamp with time zone,
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    analyzed_at timestamp with time zone,
    human_reviewed_at timestamp with time zone,
    last_error text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_interview_campaign_candidates_analysis_check CHECK ((analysis_status = ANY (ARRAY['Pending'::text, 'Queued'::text, 'Transcribing'::text, 'Analyzing'::text, 'Completed'::text, 'Needs Review'::text, 'Failed'::text, 'Not Required'::text]))),
    CONSTRAINT ai_interview_campaign_candidates_invitation_check CHECK ((invitation_status = ANY (ARRAY['Not Queued'::text, 'Queued'::text, 'Sending'::text, 'Sent'::text, 'Delivered'::text, 'Opened'::text, 'Failed'::text, 'Skipped'::text, 'Cancelled'::text]))),
    CONSTRAINT ai_interview_campaign_candidates_reminder_check CHECK (((reminder_count >= 0) AND (reminder_count <= 10))),
    CONSTRAINT ai_interview_campaign_candidates_score_check CHECK (((overall_score IS NULL) OR ((overall_score >= (0)::numeric) AND (overall_score <= (100)::numeric)))),
    CONSTRAINT ai_interview_campaign_candidates_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Queued for Invitation'::text, 'Invitation Sent'::text, 'Delivered'::text, 'Opened'::text, 'In Progress'::text, 'Completed'::text, 'Queued for Analysis'::text, 'Transcribing'::text, 'Analyzing'::text, 'Review Ready'::text, 'Needs Human Review'::text, 'Human Reviewed'::text, 'Expired'::text, 'Cancelled'::text, 'Failed'::text]))),
    CONSTRAINT ai_interview_campaign_candidates_validation_check CHECK ((validation_status = ANY (ARRAY['Pending'::text, 'Valid'::text, 'Invalid'::text, 'Duplicate'::text])))
);


--
-- Name: ai_interview_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    campaign_name text NOT NULL,
    template_id uuid NOT NULL,
    request_no text DEFAULT ''::text NOT NULL,
    project_name text DEFAULT ''::text NOT NULL,
    profession text DEFAULT ''::text NOT NULL,
    language text DEFAULT 'Bilingual'::text NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    interview_deadline timestamp with time zone,
    invitation_batch_size integer DEFAULT 20 NOT NULL,
    max_reminders integer DEFAULT 3 NOT NULL,
    first_reminder_after_hours integer DEFAULT 24 NOT NULL,
    second_reminder_after_hours integer DEFAULT 48 NOT NULL,
    final_reminder_before_hours integer DEFAULT 24 NOT NULL,
    total_candidates integer DEFAULT 0 NOT NULL,
    valid_candidates integer DEFAULT 0 NOT NULL,
    invitation_queued_count integer DEFAULT 0 NOT NULL,
    invitation_sent_count integer DEFAULT 0 NOT NULL,
    opened_count integer DEFAULT 0 NOT NULL,
    in_progress_count integer DEFAULT 0 NOT NULL,
    completed_count integer DEFAULT 0 NOT NULL,
    analyzed_count integer DEFAULT 0 NOT NULL,
    needs_review_count integer DEFAULT 0 NOT NULL,
    shortlisted_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    created_by_user_id bigint,
    created_by_name text DEFAULT ''::text NOT NULL,
    launched_at timestamp with time zone,
    closed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    notes text DEFAULT ''::text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    interaction_mode text DEFAULT 'Recorded'::text NOT NULL,
    interview_mode text DEFAULT 'Voice'::text NOT NULL,
    camera_mode text DEFAULT 'Off'::text NOT NULL,
    max_dynamic_follow_ups integer DEFAULT 1 NOT NULL,
    live_response_timeout_seconds integer DEFAULT 60 NOT NULL,
    CONSTRAINT ai_interview_campaigns_batch_size_check CHECK (((invitation_batch_size >= 1) AND (invitation_batch_size <= 100))),
    CONSTRAINT ai_interview_campaigns_language_check CHECK ((language = ANY (ARRAY['Arabic'::text, 'English'::text, 'Bilingual'::text]))),
    CONSTRAINT ai_interview_campaigns_reminders_check CHECK ((((max_reminders >= 0) AND (max_reminders <= 5)) AND (first_reminder_after_hours >= 0) AND (second_reminder_after_hours >= 0) AND (final_reminder_before_hours >= 0))),
    CONSTRAINT ai_interview_campaigns_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Ready'::text, 'Launching'::text, 'Active'::text, 'Paused'::text, 'Completed'::text, 'Cancelled'::text])))
);


--
-- Name: ai_interview_conversation_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_conversation_turns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    session_id uuid NOT NULL,
    answer_id uuid,
    turn_order integer DEFAULT 1 NOT NULL,
    speaker text NOT NULL,
    turn_type text DEFAULT 'Answer'::text NOT NULL,
    text_content text DEFAULT ''::text NOT NULL,
    language text DEFAULT ''::text NOT NULL,
    audio_storage_path text DEFAULT ''::text NOT NULL,
    video_storage_path text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_ms integer DEFAULT 0 NOT NULL,
    provider_event_id text DEFAULT ''::text NOT NULL,
    provider_response_id text DEFAULT ''::text NOT NULL,
    model_name text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_interview_conversation_turns_duration_check CHECK ((duration_ms >= 0)),
    CONSTRAINT ai_interview_conversation_turns_speaker_check CHECK ((speaker = ANY (ARRAY['AI Interviewer'::text, 'Candidate'::text, 'System'::text]))),
    CONSTRAINT ai_interview_conversation_turns_turn_order_check CHECK ((turn_order >= 1)),
    CONSTRAINT ai_interview_conversation_turns_turn_type_check CHECK ((turn_type = ANY (ARRAY['Introduction'::text, 'Question'::text, 'Follow-up'::text, 'Answer'::text, 'Clarification'::text, 'Transition'::text, 'Closing'::text, 'Event'::text])))
);


--
-- Name: ai_interview_generation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_generation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    template_id uuid,
    request_no text DEFAULT ''::text NOT NULL,
    request_line_id text DEFAULT ''::text NOT NULL,
    profession text DEFAULT ''::text NOT NULL,
    source_type text DEFAULT 'Job Description'::text NOT NULL,
    model_name text DEFAULT ''::text NOT NULL,
    prompt_version text DEFAULT 'JD-INTERVIEW-V1'::text NOT NULL,
    requested_question_count integer DEFAULT 8 NOT NULL,
    language text DEFAULT 'Bilingual'::text NOT NULL,
    difficulty_level text DEFAULT 'Medium'::text NOT NULL,
    input_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    output_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    generated_questions_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    error_message text DEFAULT ''::text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: ai_interview_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    template_id uuid NOT NULL,
    question_order integer DEFAULT 1 NOT NULL,
    question_text text NOT NULL,
    question_text_ar text DEFAULT ''::text NOT NULL,
    question_text_en text DEFAULT ''::text NOT NULL,
    question_type text DEFAULT 'Open Question'::text NOT NULL,
    competency text DEFAULT 'General'::text NOT NULL,
    difficulty_level text DEFAULT 'Medium'::text NOT NULL,
    weight numeric(5,2) DEFAULT 10 NOT NULL,
    maximum_answer_seconds integer DEFAULT 120 NOT NULL,
    expected_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    key_points jsonb DEFAULT '[]'::jsonb NOT NULL,
    scoring_guide jsonb DEFAULT '{}'::jsonb NOT NULL,
    ideal_answer text DEFAULT ''::text NOT NULL,
    recruiter_notes text DEFAULT ''::text NOT NULL,
    allow_follow_up boolean DEFAULT true NOT NULL,
    maximum_follow_ups integer DEFAULT 1 NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    updated_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_type text DEFAULT 'Manual'::text NOT NULL,
    is_ai_generated boolean DEFAULT false NOT NULL,
    job_description_evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    evaluation_risks jsonb DEFAULT '[]'::jsonb NOT NULL,
    approved_by text DEFAULT ''::text NOT NULL,
    approved_at timestamp with time zone,
    is_locked boolean DEFAULT false NOT NULL,
    ai_generation_notes text DEFAULT ''::text NOT NULL,
    is_global boolean DEFAULT false NOT NULL,
    CONSTRAINT ai_interview_questions_difficulty_level_check CHECK ((difficulty_level = ANY (ARRAY['Basic'::text, 'Easy'::text, 'Medium'::text, 'Advanced'::text, 'Expert'::text]))),
    CONSTRAINT ai_interview_questions_maximum_answer_seconds_check CHECK (((maximum_answer_seconds >= 10) AND (maximum_answer_seconds <= 1800))),
    CONSTRAINT ai_interview_questions_maximum_follow_ups_check CHECK (((maximum_follow_ups >= 0) AND (maximum_follow_ups <= 5))),
    CONSTRAINT ai_interview_questions_question_order_check CHECK ((question_order > 0)),
    CONSTRAINT ai_interview_questions_question_type_check CHECK ((question_type = ANY (ARRAY['Introduction'::text, 'Open Question'::text, 'Technical'::text, 'Behavioral'::text, 'Experience'::text, 'Language'::text, 'Availability'::text, 'Salary'::text, 'Safety'::text, 'Closing'::text]))),
    CONSTRAINT ai_interview_questions_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (100)::numeric)))
);


--
-- Name: ai_interview_session_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_session_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    event_source text DEFAULT 'Browser'::text NOT NULL,
    severity text DEFAULT 'Info'::text NOT NULL,
    event_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_interview_session_events_duration_check CHECK ((duration_seconds >= 0)),
    CONSTRAINT ai_interview_session_events_severity_check CHECK ((severity = ANY (ARRAY['Info'::text, 'Low'::text, 'Medium'::text, 'High'::text])))
);


--
-- Name: TABLE ai_interview_session_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_interview_session_events IS 'Technical session events such as tab hidden, fullscreen exit, camera interruption, microphone interruption, and connection loss. These are review signals only.';


--
-- Name: ai_interview_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    template_id uuid NOT NULL,
    candidate_id text NOT NULL,
    interview_id text DEFAULT ''::text NOT NULL,
    request_line_id text DEFAULT ''::text NOT NULL,
    request_no text DEFAULT ''::text NOT NULL,
    project_name text DEFAULT ''::text NOT NULL,
    candidate_name text NOT NULL,
    candidate_email text DEFAULT ''::text NOT NULL,
    candidate_mobile text DEFAULT ''::text NOT NULL,
    passport_no text DEFAULT ''::text NOT NULL,
    profession text DEFAULT ''::text NOT NULL,
    nationality text DEFAULT ''::text NOT NULL,
    agency_name text DEFAULT ''::text NOT NULL,
    language text DEFAULT 'English'::text NOT NULL,
    interview_mode text DEFAULT 'Voice'::text NOT NULL,
    access_token text DEFAULT encode(extensions.gen_random_bytes(24), 'hex'::text) NOT NULL,
    invitation_url text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'Created'::text NOT NULL,
    scheduled_at timestamp with time zone,
    invitation_sent_at timestamp with time zone,
    first_opened_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    consent_required boolean DEFAULT true NOT NULL,
    consent_accepted boolean DEFAULT false NOT NULL,
    consent_accepted_at timestamp with time zone,
    consent_version text DEFAULT '1.0'::text NOT NULL,
    consent_ip text DEFAULT ''::text NOT NULL,
    consent_user_agent text DEFAULT ''::text NOT NULL,
    microphone_test_passed boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    current_question_order integer DEFAULT 0 NOT NULL,
    total_questions integer DEFAULT 0 NOT NULL,
    answered_questions integer DEFAULT 0 NOT NULL,
    skipped_questions integer DEFAULT 0 NOT NULL,
    interview_duration_seconds integer DEFAULT 0 NOT NULL,
    audio_storage_path text DEFAULT ''::text NOT NULL,
    full_transcript text DEFAULT ''::text NOT NULL,
    transcript_segments jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_summary text DEFAULT ''::text NOT NULL,
    ai_strengths jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_concerns jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_risk_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    technical_score numeric(5,2),
    experience_score numeric(5,2),
    communication_score numeric(5,2),
    language_score numeric(5,2),
    safety_score numeric(5,2),
    overall_score numeric(5,2),
    ai_recommendation text DEFAULT 'Pending Analysis'::text NOT NULL,
    ai_reasoning text DEFAULT ''::text NOT NULL,
    ai_model text DEFAULT ''::text NOT NULL,
    review_status text DEFAULT 'Pending Human Review'::text NOT NULL,
    human_decision text DEFAULT 'Pending Company Review'::text NOT NULL,
    human_notes text DEFAULT ''::text NOT NULL,
    reviewed_by text DEFAULT ''::text NOT NULL,
    reviewed_at timestamp with time zone,
    failure_reason text DEFAULT ''::text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    updated_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    analysis_status text DEFAULT 'Pending'::text NOT NULL,
    analysis_started_at timestamp with time zone,
    analysis_completed_at timestamp with time zone,
    analysis_last_queued_at timestamp with time zone,
    analysis_error text DEFAULT ''::text NOT NULL,
    analysis_attempts integer DEFAULT 0 NOT NULL,
    campaign_id uuid,
    campaign_candidate_id uuid,
    participation_consent_accepted boolean DEFAULT false NOT NULL,
    participation_consent_accepted_at timestamp with time zone,
    participation_declined_at timestamp with time zone,
    employer_sharing_consent boolean DEFAULT false NOT NULL,
    employer_sharing_consent_at timestamp with time zone,
    evaluation_email_consent boolean DEFAULT false NOT NULL,
    evaluation_email_consent_at timestamp with time zone,
    evaluation_email_status text DEFAULT 'Not Requested'::text NOT NULL,
    evaluation_email_sent_at timestamp with time zone,
    evaluation_email_message_id text DEFAULT ''::text NOT NULL,
    evaluation_email_error text DEFAULT ''::text NOT NULL,
    evaluation_email_attempt_count integer DEFAULT 0 NOT NULL,
    evaluation_email_last_attempt_at timestamp with time zone,
    candidate_feedback_summary_en text DEFAULT ''::text NOT NULL,
    candidate_feedback_summary_ar text DEFAULT ''::text NOT NULL,
    candidate_feedback_strengths_en jsonb DEFAULT '[]'::jsonb NOT NULL,
    candidate_feedback_strengths_ar jsonb DEFAULT '[]'::jsonb NOT NULL,
    candidate_feedback_development_areas_en jsonb DEFAULT '[]'::jsonb NOT NULL,
    candidate_feedback_development_areas_ar jsonb DEFAULT '[]'::jsonb NOT NULL,
    interaction_mode text DEFAULT 'Recorded'::text NOT NULL,
    camera_mode text DEFAULT 'Off'::text NOT NULL,
    camera_access_consent_accepted boolean DEFAULT false NOT NULL,
    camera_access_consent_accepted_at timestamp with time zone,
    video_recording_consent_accepted boolean DEFAULT false NOT NULL,
    video_recording_consent_accepted_at timestamp with time zone,
    camera_permission_status text DEFAULT 'Not Requested'::text NOT NULL,
    camera_test_passed boolean DEFAULT false NOT NULL,
    camera_tested_at timestamp with time zone,
    full_video_storage_path text DEFAULT ''::text NOT NULL,
    full_video_duration_seconds integer DEFAULT 0 NOT NULL,
    full_video_mime_type text DEFAULT ''::text NOT NULL,
    tab_switch_count integer DEFAULT 0 NOT NULL,
    fullscreen_exit_count integer DEFAULT 0 NOT NULL,
    camera_interruption_count integer DEFAULT 0 NOT NULL,
    microphone_interruption_count integer DEFAULT 0 NOT NULL,
    realtime_connection_status text DEFAULT 'Not Started'::text NOT NULL,
    realtime_provider_session_id text DEFAULT ''::text NOT NULL,
    realtime_started_at timestamp with time zone,
    realtime_ended_at timestamp with time zone,
    realtime_disconnect_count integer DEFAULT 0 NOT NULL,
    last_realtime_error text DEFAULT ''::text NOT NULL,
    live_response_timeout_seconds integer DEFAULT 60 NOT NULL,
    max_dynamic_follow_ups integer DEFAULT 1 NOT NULL,
    CONSTRAINT ai_interview_sessions_analysis_attempts_check CHECK (((analysis_attempts >= 0) AND (analysis_attempts <= 20))),
    CONSTRAINT ai_interview_sessions_analysis_status_check CHECK ((analysis_status = ANY (ARRAY['Pending'::text, 'Queued'::text, 'Transcribing'::text, 'Analyzing'::text, 'Completed'::text, 'Failed'::text, 'Needs Review'::text]))),
    CONSTRAINT ai_interview_sessions_camera_mode_check CHECK ((camera_mode = ANY (ARRAY['Off'::text, 'Optional'::text, 'Required'::text]))),
    CONSTRAINT ai_interview_sessions_camera_permission_status_check CHECK ((camera_permission_status = ANY (ARRAY['Not Requested'::text, 'Granted'::text, 'Denied'::text, 'Unavailable'::text, 'Error'::text]))),
    CONSTRAINT ai_interview_sessions_communication_score_check CHECK (((communication_score IS NULL) OR ((communication_score >= (0)::numeric) AND (communication_score <= (100)::numeric)))),
    CONSTRAINT ai_interview_sessions_experience_score_check CHECK (((experience_score IS NULL) OR ((experience_score >= (0)::numeric) AND (experience_score <= (100)::numeric)))),
    CONSTRAINT ai_interview_sessions_human_decision_check CHECK ((human_decision = ANY (ARRAY['Pending Company Review'::text, 'Recommended'::text, 'Second Interview'::text, 'Technical Interview'::text, 'On Hold'::text, 'Not Recommended'::text, 'Accepted'::text, 'Rejected'::text]))),
    CONSTRAINT ai_interview_sessions_interaction_mode_check CHECK ((interaction_mode = ANY (ARRAY['Recorded'::text, 'Live Conversational'::text]))),
    CONSTRAINT ai_interview_sessions_interview_mode_check CHECK ((interview_mode = ANY (ARRAY['Voice'::text, 'Video'::text, 'Text'::text]))),
    CONSTRAINT ai_interview_sessions_language_score_check CHECK (((language_score IS NULL) OR ((language_score >= (0)::numeric) AND (language_score <= (100)::numeric)))),
    CONSTRAINT ai_interview_sessions_nonnegative_integrity_counts_check CHECK (((tab_switch_count >= 0) AND (fullscreen_exit_count >= 0) AND (camera_interruption_count >= 0) AND (microphone_interruption_count >= 0) AND (realtime_disconnect_count >= 0) AND (full_video_duration_seconds >= 0))),
    CONSTRAINT ai_interview_sessions_overall_score_check CHECK (((overall_score IS NULL) OR ((overall_score >= (0)::numeric) AND (overall_score <= (100)::numeric)))),
    CONSTRAINT ai_interview_sessions_realtime_connection_status_check CHECK ((realtime_connection_status = ANY (ARRAY['Not Started'::text, 'Connecting'::text, 'Connected'::text, 'Reconnecting'::text, 'Disconnected'::text, 'Completed'::text, 'Failed'::text]))),
    CONSTRAINT ai_interview_sessions_review_status_check CHECK ((review_status = ANY (ARRAY['Pending Human Review'::text, 'Under Human Review'::text, 'Human Review Completed'::text]))),
    CONSTRAINT ai_interview_sessions_safety_score_check CHECK (((safety_score IS NULL) OR ((safety_score >= (0)::numeric) AND (safety_score <= (100)::numeric)))),
    CONSTRAINT ai_interview_sessions_status_check CHECK ((status = ANY (ARRAY['Created'::text, 'Invitation Pending'::text, 'Invited'::text, 'Opened'::text, 'Consent Pending'::text, 'Ready'::text, 'In Progress'::text, 'Processing'::text, 'Completed'::text, 'Expired'::text, 'Cancelled'::text, 'Failed'::text]))),
    CONSTRAINT ai_interview_sessions_technical_score_check CHECK (((technical_score IS NULL) OR ((technical_score >= (0)::numeric) AND (technical_score <= (100)::numeric))))
);


--
-- Name: COLUMN ai_interview_sessions.participation_consent_accepted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.participation_consent_accepted IS 'Required voluntary consent to participate in the VisaFlow AI interview pilot.';


--
-- Name: COLUMN ai_interview_sessions.participation_declined_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.participation_declined_at IS 'Timestamp when the candidate declined the voluntary pilot.';


--
-- Name: COLUMN ai_interview_sessions.employer_sharing_consent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.employer_sharing_consent IS 'Optional, separate consent to share the candidate profile and interview result with partner employers.';


--
-- Name: COLUMN ai_interview_sessions.evaluation_email_consent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.evaluation_email_consent IS 'Optional consent to email the candidate a brief experimental evaluation summary.';


--
-- Name: COLUMN ai_interview_sessions.evaluation_email_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.evaluation_email_status IS 'Candidate evaluation email lifecycle: Not Requested, Pending, Processing, Sent, or Failed.';


--
-- Name: COLUMN ai_interview_sessions.candidate_feedback_summary_en; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.candidate_feedback_summary_en IS 'Candidate-safe English feedback generated separately from the internal hiring analysis.';


--
-- Name: COLUMN ai_interview_sessions.candidate_feedback_summary_ar; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.candidate_feedback_summary_ar IS 'Candidate-safe Arabic feedback generated separately from the internal hiring analysis.';


--
-- Name: COLUMN ai_interview_sessions.camera_access_consent_accepted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.camera_access_consent_accepted IS 'Candidate consent to activate camera access for this session.';


--
-- Name: COLUMN ai_interview_sessions.video_recording_consent_accepted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.video_recording_consent_accepted IS 'Candidate consent to record and store interview video.';


--
-- Name: COLUMN ai_interview_sessions.tab_switch_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_sessions.tab_switch_count IS 'Technical review signal only; not proof of misconduct.';


--
-- Name: ai_interview_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interview_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    template_name text NOT NULL,
    profession text DEFAULT ''::text NOT NULL,
    profession_category text DEFAULT 'General'::text NOT NULL,
    language text DEFAULT 'English'::text NOT NULL,
    interview_mode text DEFAULT 'Voice'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    candidate_instructions text DEFAULT ''::text NOT NULL,
    opening_message text DEFAULT 'Welcome to your VisaFlow AI interview. Please answer each question clearly.'::text NOT NULL,
    closing_message text DEFAULT 'Thank you. Your interview has been completed and will be reviewed by the recruitment team.'::text NOT NULL,
    consent_text text DEFAULT 'I understand that this interview may be recorded, transcribed and analyzed using artificial intelligence for recruitment evaluation. The final decision remains with the company.'::text NOT NULL,
    duration_minutes integer DEFAULT 15 NOT NULL,
    maximum_questions integer DEFAULT 10 NOT NULL,
    passing_score numeric(5,2) DEFAULT 70 NOT NULL,
    allow_ai_follow_up boolean DEFAULT true NOT NULL,
    allow_candidate_retry boolean DEFAULT false NOT NULL,
    maximum_retries integer DEFAULT 0 NOT NULL,
    require_microphone_test boolean DEFAULT true NOT NULL,
    require_consent boolean DEFAULT true NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    updated_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_type text DEFAULT 'Ready Template'::text NOT NULL,
    job_description text DEFAULT ''::text NOT NULL,
    job_description_language text DEFAULT 'Auto'::text NOT NULL,
    request_no text DEFAULT ''::text NOT NULL,
    request_line_id text DEFAULT ''::text NOT NULL,
    ai_analysis jsonb DEFAULT '{}'::jsonb NOT NULL,
    extracted_competencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    extracted_tasks jsonb DEFAULT '[]'::jsonb NOT NULL,
    extracted_skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    extracted_safety_requirements jsonb DEFAULT '[]'::jsonb NOT NULL,
    missing_job_information jsonb DEFAULT '[]'::jsonb NOT NULL,
    job_description_quality_score numeric(5,2),
    requested_question_count integer DEFAULT 8 NOT NULL,
    interview_difficulty text DEFAULT 'Medium'::text NOT NULL,
    generation_status text DEFAULT 'Not Generated'::text NOT NULL,
    approval_status text DEFAULT 'Draft'::text NOT NULL,
    approved_by text DEFAULT ''::text NOT NULL,
    approved_at timestamp with time zone,
    rejected_by text DEFAULT ''::text NOT NULL,
    rejected_at timestamp with time zone,
    rejection_reason text DEFAULT ''::text NOT NULL,
    ai_model text DEFAULT ''::text NOT NULL,
    prompt_version text DEFAULT 'JD-INTERVIEW-V1'::text NOT NULL,
    generation_error text DEFAULT ''::text NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    generated_at timestamp with time zone,
    last_generated_by text DEFAULT ''::text NOT NULL,
    is_global boolean DEFAULT false NOT NULL,
    interaction_mode text DEFAULT 'Recorded'::text NOT NULL,
    camera_mode text DEFAULT 'Off'::text NOT NULL,
    video_recording_mode text DEFAULT 'Per Answer'::text NOT NULL,
    allow_ai_follow_ups boolean DEFAULT true NOT NULL,
    max_dynamic_follow_ups integer DEFAULT 1 NOT NULL,
    live_response_timeout_seconds integer DEFAULT 60 NOT NULL,
    allow_candidate_barge_in boolean DEFAULT true NOT NULL,
    save_live_audio boolean DEFAULT true NOT NULL,
    save_live_video boolean DEFAULT false NOT NULL,
    realtime_voice_name text DEFAULT ''::text NOT NULL,
    realtime_model_name text DEFAULT ''::text NOT NULL,
    template_group_id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    is_current_version boolean DEFAULT true NOT NULL,
    supersedes_template_id uuid,
    version_notes text,
    CONSTRAINT ai_interview_templates_camera_mode_check CHECK ((camera_mode = ANY (ARRAY['Off'::text, 'Optional'::text, 'Required'::text]))),
    CONSTRAINT ai_interview_templates_duration_minutes_check CHECK (((duration_minutes >= 1) AND (duration_minutes <= 120))),
    CONSTRAINT ai_interview_templates_interaction_mode_check CHECK ((interaction_mode = ANY (ARRAY['Recorded'::text, 'Live Conversational'::text]))),
    CONSTRAINT ai_interview_templates_interview_mode_check CHECK ((interview_mode = ANY (ARRAY['Voice'::text, 'Video'::text, 'Text'::text]))),
    CONSTRAINT ai_interview_templates_live_response_timeout_check CHECK (((live_response_timeout_seconds >= 10) AND (live_response_timeout_seconds <= 300))),
    CONSTRAINT ai_interview_templates_max_dynamic_follow_ups_check CHECK (((max_dynamic_follow_ups >= 0) AND (max_dynamic_follow_ups <= 5))),
    CONSTRAINT ai_interview_templates_maximum_questions_check CHECK (((maximum_questions >= 1) AND (maximum_questions <= 100))),
    CONSTRAINT ai_interview_templates_maximum_retries_check CHECK (((maximum_retries >= 0) AND (maximum_retries <= 10))),
    CONSTRAINT ai_interview_templates_passing_score_check CHECK (((passing_score >= (0)::numeric) AND (passing_score <= (100)::numeric))),
    CONSTRAINT ai_interview_templates_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Active'::text, 'Inactive'::text, 'Archived'::text]))),
    CONSTRAINT ai_interview_templates_video_recording_mode_check CHECK ((video_recording_mode = ANY (ARRAY['Per Answer'::text, 'Continuous'::text]))),
    CONSTRAINT ai_templates_approval_status_check CHECK ((approval_status = ANY (ARRAY['Draft'::text, 'Pending Review'::text, 'Approved'::text, 'Rejected'::text, 'Archived'::text]))),
    CONSTRAINT ai_templates_generation_status_check CHECK ((generation_status = ANY (ARRAY['Not Generated'::text, 'Pending'::text, 'Analyzing'::text, 'Generated'::text, 'Failed'::text]))),
    CONSTRAINT ai_templates_interview_difficulty_check CHECK ((interview_difficulty = ANY (ARRAY['Basic'::text, 'Easy'::text, 'Medium'::text, 'Advanced'::text, 'Expert'::text]))),
    CONSTRAINT ai_templates_quality_score_check CHECK (((job_description_quality_score IS NULL) OR ((job_description_quality_score >= (0)::numeric) AND (job_description_quality_score <= (100)::numeric)))),
    CONSTRAINT ai_templates_requested_question_count_check CHECK (((requested_question_count >= 3) AND (requested_question_count <= 30))),
    CONSTRAINT ai_templates_source_type_check CHECK ((source_type = ANY (ARRAY['Ready Template'::text, 'Job Description'::text, 'Hybrid'::text, 'Manual'::text])))
);


--
-- Name: COLUMN ai_interview_templates.interaction_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_templates.interaction_mode IS 'Recorded or Live Conversational. Separate from interview_mode, which remains Voice, Video, or Text.';


--
-- Name: COLUMN ai_interview_templates.camera_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_interview_templates.camera_mode IS 'Off, Optional, or Required for the candidate session.';


--
-- Name: candidate_technical_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_technical_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    request_no text,
    request_line_id bigint,
    qualification text,
    major text,
    specialization text,
    institution_id uuid,
    institution_name text,
    institution_country text,
    institution_type text,
    graduation_year integer,
    years_experience numeric(5,2) DEFAULT 0,
    last_job_title text,
    last_employer text,
    last_project_type text,
    project_experience text,
    technical_skills text,
    tools_and_equipment text,
    software_skills text,
    certifications text,
    licenses text,
    english_level text DEFAULT 'Not Specified'::text,
    arabic_level text DEFAULT 'Not Specified'::text,
    gulf_experience boolean DEFAULT false,
    saudi_experience boolean DEFAULT false,
    profile_completed boolean DEFAULT false,
    missing_fields text[] DEFAULT '{}'::text[],
    education_score numeric(5,2) DEFAULT 0,
    experience_score numeric(5,2) DEFAULT 0,
    skills_score numeric(5,2) DEFAULT 0,
    certification_score numeric(5,2) DEFAULT 0,
    language_score numeric(5,2) DEFAULT 0,
    data_completeness_score numeric(5,2) DEFAULT 0,
    final_ai_score numeric(5,2) DEFAULT 0,
    interview_priority text DEFAULT 'Pending Review'::text,
    ai_recommendation text,
    ai_reasoning text,
    final_company_decision text DEFAULT 'Pending Company Review'::text,
    decision_by text,
    decision_at timestamp with time zone,
    decision_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT candidate_technical_profiles_decision_check CHECK ((final_company_decision = ANY (ARRAY['Pending Company Review'::text, 'Shortlisted'::text, 'Interview'::text, 'Rejected'::text, 'On Hold'::text, 'Accepted'::text]))),
    CONSTRAINT candidate_technical_profiles_priority_check CHECK ((interview_priority = ANY (ARRAY['Interview First'::text, 'Shortlist'::text, 'Review'::text, 'Low Priority'::text, 'Pending Review'::text])))
);


--
-- Name: TABLE candidate_technical_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.candidate_technical_profiles IS 'VisaFlow Candidate Intelligence is a decision-support tool only. Final hiring, interview, acceptance, or rejection decisions remain the responsibility of the client company.';


--
-- Name: COLUMN candidate_technical_profiles.final_ai_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.candidate_technical_profiles.final_ai_score IS 'Decision-support score only, not an automatic hiring decision.';


--
-- Name: COLUMN candidate_technical_profiles.final_company_decision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.candidate_technical_profiles.final_company_decision IS 'Final decision selected by the client company.';


--
-- Name: candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_no text,
    candidate_name text NOT NULL,
    profession text,
    nationality text,
    agency text,
    project text,
    passport_no text,
    mobile text,
    status text DEFAULT 'New'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gender text,
    status_history text,
    email text,
    medical_status text,
    medical_date date,
    ticket_no text,
    flight_date date,
    arrival_date date,
    visa_fees numeric DEFAULT 0,
    agency_commission numeric DEFAULT 0,
    ticket_cost numeric DEFAULT 0,
    medical_ksa_cost numeric DEFAULT 0,
    contract_status text DEFAULT 'Pending'::text,
    contract_url text,
    replacement_reason text,
    replacement_for_candidate_id bigint,
    source text,
    offer_status text DEFAULT 'Pending'::text,
    joining_date date,
    company_id uuid,
    request_line_id uuid,
    technical_profile_required boolean DEFAULT false,
    technical_profile_completed boolean DEFAULT false,
    ai_score numeric(5,2) DEFAULT 0,
    ai_priority text DEFAULT 'Pending Review'::text,
    ai_recommendation text,
    ai_reasoning text,
    final_company_decision text DEFAULT 'Pending Company Review'::text,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text,
    civil_id_no text,
    civil_id_expiry_date date
);


--
-- Name: COLUMN candidates.civil_id_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.candidates.civil_id_no IS 'Saudi Civil ID / National ID number for Saudi candidates';


--
-- Name: COLUMN candidates.civil_id_expiry_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.candidates.civil_id_expiry_date IS 'Saudi Civil ID / National ID card expiry date for Saudi candidates';


--
-- Name: collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collections (
    id bigint NOT NULL,
    company_id uuid NOT NULL,
    invoice_id bigint,
    invoice_no text,
    client_name text,
    collection_date date DEFAULT CURRENT_DATE,
    amount numeric DEFAULT 0,
    payment_method text,
    reference_no text,
    status text DEFAULT 'Received'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text
);


--
-- Name: collections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.collections ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.collections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    domain text,
    status text DEFAULT 'Active'::text,
    created_at timestamp with time zone DEFAULT now(),
    subscription_plan text DEFAULT 'Trial'::text,
    subscription_status text DEFAULT 'Active'::text,
    subscription_start date DEFAULT CURRENT_DATE,
    subscription_end date,
    max_users integer DEFAULT 5,
    notes text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: company_agency_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_agency_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    agency_id uuid NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    can_view_requests boolean DEFAULT true NOT NULL,
    can_upload_candidates boolean DEFAULT true NOT NULL,
    can_update_candidates boolean DEFAULT true NOT NULL,
    can_view_interviews boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_agency_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_agency_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    agency_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'Agency'::text,
    status text DEFAULT 'Active'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: company_email_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_email_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    mode text DEFAULT 'platform'::text NOT NULL,
    provider text DEFAULT 'SMTP'::text NOT NULL,
    smtp_host text,
    smtp_port integer DEFAULT 465,
    smtp_secure boolean DEFAULT true,
    smtp_username text,
    smtp_password text,
    from_name text,
    from_email text,
    reply_to text,
    agreements_email text,
    notifications_email text,
    support_email text,
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    last_test_at timestamp with time zone,
    last_test_status text,
    last_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.countries (
    id bigint NOT NULL,
    name text NOT NULL,
    nationality text,
    iso_code text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: countries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.countries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.countries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: demobilizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demobilizations (
    id bigint NOT NULL,
    company_id uuid,
    employee_name text,
    employee_id text,
    iqama_no text,
    profession text,
    nationality text,
    gender text,
    current_project text,
    demob_date date,
    reason text,
    status text DEFAULT 'Available'::text,
    suggested_request_no text,
    suggested_project text,
    match_score numeric DEFAULT 0,
    ai_recommendation text,
    invoice_required text DEFAULT 'No'::text,
    invoice_amount numeric DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    invoice_type text DEFAULT 'Redeployment Service'::text,
    redeployment_cost numeric DEFAULT 500,
    estimated_new_recruitment_cost numeric DEFAULT 3650,
    estimated_saving numeric DEFAULT 0,
    recruitment_avoided text DEFAULT 'Yes'::text
);


--
-- Name: demobilizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.demobilizations ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.demobilizations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: education_institutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.education_institutions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    country text NOT NULL,
    institution_name text NOT NULL,
    institution_type text DEFAULT 'University'::text NOT NULL,
    recognition_status text DEFAULT 'Needs Review'::text NOT NULL,
    ranking_or_accreditation text,
    employer_reputation text,
    key_specializations text,
    reputation_score numeric(5,2) DEFAULT 40,
    technical_strength_score numeric(5,2) DEFAULT 40,
    internal_notes text,
    is_active boolean DEFAULT true,
    source_name text DEFAULT 'Internal Database'::text,
    source_file text,
    verified_by text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT education_institutions_recognition_check CHECK ((recognition_status = ANY (ARRAY['Verified'::text, 'Recommended'::text, 'Needs Review'::text, 'Unknown'::text, 'Blacklisted'::text]))),
    CONSTRAINT education_institutions_score_check CHECK ((((reputation_score >= (0)::numeric) AND (reputation_score <= (100)::numeric)) AND ((technical_strength_score >= (0)::numeric) AND (technical_strength_score <= (100)::numeric)))),
    CONSTRAINT education_institutions_type_check CHECK ((institution_type = ANY (ARRAY['University'::text, 'College'::text, 'Institute'::text, 'Training Center'::text, 'Certification Body'::text, 'Other'::text])))
);


--
-- Name: email_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    event_type text,
    status text DEFAULT 'Queued'::text,
    provider text,
    from_email text,
    to_emails text,
    cc_emails text,
    bcc_emails text,
    subject text,
    message_id text,
    error_message text,
    related_table text,
    related_id text,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    type text DEFAULT 'EMAIL'::text,
    to_email text,
    cc_email text,
    bcc_email text
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    company_id uuid,
    template_key text,
    template_name text,
    category text DEFAULT 'Recruitment'::text,
    language text DEFAULT 'Bilingual'::text,
    subject text,
    body text,
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id bigint NOT NULL,
    company_id uuid NOT NULL,
    employee_no text,
    employee_name text,
    iqama_no text,
    nationality text,
    gender text,
    profession text,
    project_name text,
    department text,
    joining_date date,
    contract_end_date date,
    status text DEFAULT 'Active'::text,
    source_candidate_id bigint,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    marketplace_status text DEFAULT 'Available'::text,
    marketplace_deal_id text,
    iqama_expiry_date date,
    insurance_policy_end_date date,
    monthly_medical_insurance numeric DEFAULT 0,
    annual_medical_insurance numeric DEFAULT 0,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text,
    salary numeric DEFAULT 0,
    monthly_salary numeric DEFAULT 0,
    project_city text,
    project_location text
);


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.employees ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: interviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    candidate_name text,
    profession text,
    nationality text,
    agency text,
    project text,
    interview_date date,
    interview_type text,
    interviewers text,
    score text,
    notes text,
    status text,
    request_no text,
    updated_at timestamp with time zone DEFAULT now(),
    candidate_id uuid,
    mobile text,
    passport_no text,
    company_id uuid,
    request_line_id uuid,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text
);


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id bigint NOT NULL,
    company_id uuid NOT NULL,
    invoice_id bigint,
    description text,
    quantity numeric DEFAULT 1,
    unit_price numeric DEFAULT 0,
    total numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    calc_breakdown jsonb DEFAULT '{}'::jsonb
);


--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.invoice_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.invoice_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id bigint NOT NULL,
    company_id uuid NOT NULL,
    invoice_no text,
    deal_id bigint,
    client_name text,
    invoice_date date DEFAULT CURRENT_DATE,
    due_date date,
    service_type text,
    subtotal numeric DEFAULT 0,
    vat_amount numeric DEFAULT 0,
    total_amount numeric DEFAULT 0,
    paid_amount numeric DEFAULT 0,
    balance_amount numeric DEFAULT 0,
    status text DEFAULT 'Draft'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    deal_no text,
    agreement_no text,
    deal_type text,
    vat_rate numeric DEFAULT 0.15,
    calc_breakdown jsonb DEFAULT '{}'::jsonb,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.invoices ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: local_content_project_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_content_project_targets (
    id bigint NOT NULL,
    company_id uuid NOT NULL,
    project_name text NOT NULL,
    target_percent numeric DEFAULT 35 NOT NULL,
    monthly_invoice_amount numeric DEFAULT 0 NOT NULL,
    penalty_percent numeric DEFAULT 5 NOT NULL,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_city text,
    project_location text
);


--
-- Name: local_content_project_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.local_content_project_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: local_content_project_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.local_content_project_targets_id_seq OWNED BY public.local_content_project_targets.id;


--
-- Name: local_content_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_content_settings (
    company_id uuid NOT NULL,
    saudi_labor_weight numeric DEFAULT 100 NOT NULL,
    non_saudi_labor_weight numeric DEFAULT 54 NOT NULL,
    default_target_percent numeric DEFAULT 35 NOT NULL,
    forecast_days integer DEFAULT 90 NOT NULL,
    expiring_window_days integer DEFAULT 60 NOT NULL,
    default_monthly_penalty_percent numeric DEFAULT 5 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_deal_workers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_deal_workers (
    id bigint NOT NULL,
    company_id uuid,
    deal_id text,
    deal_no text,
    employee_id text,
    employee_no text,
    employee_name text,
    iqama_no text,
    profession text,
    nationality text,
    gender text,
    project_name text,
    worker_status text DEFAULT 'Reserved'::text,
    notes text,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    iqama_expiry_date date,
    insurance_policy_end_date date,
    monthly_medical_insurance numeric DEFAULT 0,
    annual_medical_insurance numeric DEFAULT 0
);


--
-- Name: marketplace_deal_workers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketplace_deal_workers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketplace_deal_workers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketplace_deal_workers_id_seq OWNED BY public.marketplace_deal_workers.id;


--
-- Name: marketplace_deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_deals (
    id bigint NOT NULL,
    company_id uuid NOT NULL,
    deal_no text,
    marketplace_request_id bigint,
    client_name text,
    service_type text DEFAULT 'Manpower Supply'::text,
    profession text,
    quantity numeric DEFAULT 0,
    duration_months numeric DEFAULT 1,
    monthly_rate numeric DEFAULT 0,
    total_value numeric DEFAULT 0,
    status text DEFAULT 'Draft'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    deal_type text DEFAULT 'Service Rental'::text,
    nationality text,
    gender text,
    base_salary numeric DEFAULT 0,
    monthly_medical_insurance numeric DEFAULT 0,
    pricing_method text DEFAULT 'Margin Percent'::text,
    margin_percent numeric DEFAULT 15,
    manual_monthly_rate numeric DEFAULT 0,
    iqama_expiry_date date,
    insurance_policy_end_date date,
    transfer_remaining_months numeric DEFAULT 0,
    transfer_medical_insurance_remaining numeric DEFAULT 0,
    transfer_service_fee numeric DEFAULT 0,
    admin_fee_method text DEFAULT 'Percent'::text,
    admin_fee_percent numeric DEFAULT 10,
    admin_fee_amount numeric DEFAULT 0,
    transfer_status text DEFAULT 'Transfer Pending'::text,
    calc_breakdown jsonb DEFAULT '{}'::jsonb,
    agreement_no text,
    agreement_status text DEFAULT 'Not Generated'::text,
    agreement_text text,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text,
    source_type text DEFAULT 'Manual'::text,
    source_employee_ids jsonb DEFAULT '[]'::jsonb,
    selected_workers jsonb DEFAULT '[]'::jsonb,
    annual_medical_insurance numeric DEFAULT 0
);


--
-- Name: marketplace_deals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_deals ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.marketplace_deals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: marketplace_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_requests (
    id bigint NOT NULL,
    company_id uuid NOT NULL,
    request_no text,
    client_name text,
    profession text,
    nationality text,
    gender text,
    quantity numeric DEFAULT 0,
    duration_months numeric DEFAULT 1,
    monthly_rate numeric DEFAULT 0,
    status text DEFAULT 'Open'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    deal_type text DEFAULT 'Service Rental'::text,
    service_type text,
    base_salary numeric DEFAULT 0,
    monthly_medical_insurance numeric DEFAULT 0,
    pricing_method text DEFAULT 'Margin Percent'::text,
    margin_percent numeric DEFAULT 15,
    manual_monthly_rate numeric DEFAULT 0,
    iqama_expiry_date date,
    insurance_policy_end_date date,
    transfer_remaining_months numeric DEFAULT 0,
    transfer_medical_insurance_remaining numeric DEFAULT 0,
    transfer_service_fee numeric DEFAULT 0,
    admin_fee_method text DEFAULT 'Percent'::text,
    admin_fee_percent numeric DEFAULT 10,
    admin_fee_amount numeric DEFAULT 0,
    transfer_status text DEFAULT 'Transfer Pending'::text,
    estimated_total_value numeric DEFAULT 0,
    calc_breakdown jsonb DEFAULT '{}'::jsonb,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text,
    source_type text DEFAULT 'Manual'::text,
    source_employee_ids jsonb DEFAULT '[]'::jsonb,
    selected_workers jsonb DEFAULT '[]'::jsonb,
    annual_medical_insurance numeric DEFAULT 0
);


--
-- Name: marketplace_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_requests ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.marketplace_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mobilizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobilizations (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    candidate_id bigint,
    request_no text,
    candidate_name text,
    profession text,
    nationality text,
    medical_status text,
    medical_date date,
    visa_status text,
    visa_date date,
    ticket_no text,
    flight_date date,
    arrival_date date,
    joining_date date,
    mobilization_status text,
    remarks text,
    company_id uuid,
    request_line_id uuid
);


--
-- Name: mobilizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.mobilizations ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.mobilizations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_events (
    id bigint NOT NULL,
    status text NOT NULL,
    data jsonb,
    delivery_status text DEFAULT 'Pending'::text,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    company_id uuid,
    user_id uuid,
    agency_id uuid,
    type text,
    title text,
    message text,
    priority text DEFAULT 'Medium'::text,
    related_table text,
    related_id text,
    read_at timestamp with time zone,
    request_no text,
    agency_name text,
    response_status text DEFAULT 'Pending'::text,
    response_at timestamp with time zone,
    rejection_reason text,
    sla_started_at timestamp with time zone,
    sla_days integer,
    sla_due_at timestamp with time zone,
    dedupe_key text
);


--
-- Name: notification_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_events_id_seq OWNED BY public.notification_events.id;


--
-- Name: onboarding_validations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_validations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    request_no text,
    candidate_name text,
    passport_no text,
    agency_name text,
    agency_id uuid,
    profession text,
    nationality text,
    project text,
    arrival_date date,
    joining_date date,
    validation_start_date date DEFAULT CURRENT_DATE NOT NULL,
    validation_due_date date DEFAULT (CURRENT_DATE + '90 days'::interval) NOT NULL,
    day_30_status text DEFAULT 'Pending'::text,
    day_30_score numeric DEFAULT 0,
    day_30_notes text,
    day_30_checked_at timestamp with time zone,
    day_30_checked_by text,
    day_60_status text DEFAULT 'Pending'::text,
    day_60_score numeric DEFAULT 0,
    day_60_notes text,
    day_60_checked_at timestamp with time zone,
    day_60_checked_by text,
    day_90_status text DEFAULT 'Pending'::text,
    day_90_score numeric DEFAULT 0,
    day_90_notes text,
    day_90_checked_at timestamp with time zone,
    day_90_checked_by text,
    attendance_score numeric DEFAULT 0,
    behavior_score numeric DEFAULT 0,
    productivity_score numeric DEFAULT 0,
    supervisor_score numeric DEFAULT 0,
    safety_score numeric DEFAULT 0,
    final_score numeric DEFAULT 0,
    final_result text DEFAULT 'Under Monitoring'::text,
    agency_impact_score numeric DEFAULT 0,
    agency_impact_type text DEFAULT 'Neutral'::text,
    replacement_required boolean DEFAULT false,
    issue_type text,
    issue_notes text,
    status text DEFAULT 'Active Monitoring'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    worker_validation_required boolean DEFAULT true,
    agency_impact_eligible boolean DEFAULT false,
    validation_scope text DEFAULT 'Worker Only'::text
);


--
-- Name: platform_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    domain text,
    subscription_status text DEFAULT 'Active'::text,
    users_count integer DEFAULT 0,
    start_date date,
    end_date date,
    monthly_amount numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    operational_company_id uuid
);


--
-- Name: profession_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profession_aliases (
    id bigint NOT NULL,
    company_id uuid,
    profession_id bigint NOT NULL,
    alias_name text NOT NULL,
    normalized_alias text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: profession_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.profession_aliases ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.profession_aliases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: professions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professions (
    id bigint NOT NULL,
    code text,
    name_ar text NOT NULL,
    name_en text,
    category text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    profession_category text DEFAULT 'General'::text,
    technical_profile_required boolean DEFAULT false,
    intelligence_notes text,
    candidate_intelligence_level text DEFAULT 'None'::text,
    candidate_intelligence_profile text DEFAULT 'None'::text,
    is_active boolean DEFAULT true,
    CONSTRAINT professions_candidate_intelligence_level_check CHECK ((candidate_intelligence_level = ANY (ARRAY['None'::text, 'Basic'::text, 'Technical'::text, 'Professional'::text, 'Advanced'::text])))
);


--
-- Name: professions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.professions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.professions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    company_id uuid,
    full_name text,
    role text DEFAULT 'User'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: request_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid,
    action text,
    details text,
    changed_by text,
    created_at timestamp with time zone DEFAULT now(),
    company_id uuid
);


--
-- Name: request_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_no text NOT NULL,
    project_name text,
    profession text,
    nationality text,
    gender text,
    quantity bigint DEFAULT '0'::bigint,
    salary bigint DEFAULT '0'::bigint,
    priority text,
    status text DEFAULT 'Open'::text,
    created_at timestamp with time zone DEFAULT '2026-05-18 20:48:20.782183+00'::timestamp with time zone,
    updated_at timestamp with time zone DEFAULT '2026-05-18 20:48:20.782183+00'::timestamp with time zone,
    company_id uuid,
    request_id bigint,
    line_no integer DEFAULT 1,
    interview_required text DEFAULT 'Required'::text,
    interview_type text DEFAULT 'Online'::text,
    notes text,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text
);


--
-- Name: request_no_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.request_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requests (
    id bigint NOT NULL,
    request_type text,
    project_name text,
    department text,
    profession text,
    quantity text,
    nationality text,
    salary text,
    priority text,
    status text,
    requested_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    approval_status text DEFAULT 'Pending Recruitment Approval'::text,
    request_status text DEFAULT 'Draft'::text,
    updated_at timestamp with time zone,
    last_change_summary text,
    recruitment_approved_by text,
    recruitment_approved_at timestamp with time zone,
    request_no text,
    gender text,
    allocated_visa_qty bigint,
    project_start date,
    project_end date,
    request_date date,
    visa_no text,
    interview_required text DEFAULT 'Required'::text,
    interview_type text DEFAULT 'Online'::text,
    remaining_qty numeric DEFAULT 0,
    recruitment_type text DEFAULT 'Foreign'::text,
    company_id uuid,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text,
    project_city text,
    project_location text,
    project_no text
);


--
-- Name: COLUMN requests.project_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.requests.project_no IS 'Company project number / cost center reference used to link recruitment requests with project cost center.';


--
-- Name: requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.requests ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: subscription_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    invoice_no text,
    amount numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'Unpaid'::text,
    due_date date,
    paid_at date,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    ticket_no text,
    title text NOT NULL,
    description text,
    status text DEFAULT 'Open'::text,
    priority text DEFAULT 'Medium'::text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);


--
-- Name: system_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    request_no text,
    module_name text NOT NULL,
    record_id text,
    record_label text,
    action_type text NOT NULL,
    action_title text,
    old_values jsonb DEFAULT '{}'::jsonb,
    new_values jsonb DEFAULT '{}'::jsonb,
    changed_fields jsonb DEFAULT '[]'::jsonb,
    changed_by_user_id bigint,
    changed_by_name text,
    changed_by_email text,
    changed_by_role text,
    notes text,
    source text DEFAULT 'App'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    backup_type text DEFAULT 'Company'::text,
    status text DEFAULT 'Completed'::text,
    file_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    company_id uuid,
    file_name text,
    file_size text,
    tables_count integer DEFAULT 0,
    records_count integer DEFAULT 0,
    created_by text,
    completed_at timestamp with time zone,
    storage_bucket text DEFAULT 'visaflow-backups'::text,
    storage_path text,
    signed_url text,
    signed_url_expires_at timestamp with time zone,
    started_at timestamp with time zone,
    requested_by_user_id bigint,
    processor_run_id text,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT system_backups_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text])))
);


--
-- Name: system_restore_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_restore_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    backup_id uuid NOT NULL,
    restore_scope text DEFAULT 'Company'::text NOT NULL,
    restore_mode text DEFAULT 'Safe Missing Records'::text NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    reason text,
    client_request_reference text,
    requested_by_user_id bigint,
    requested_by_name text,
    pre_restore_backup_id uuid,
    preview_tables_count integer DEFAULT 0,
    preview_records_count integer DEFAULT 0,
    restored_tables_count integer DEFAULT 0,
    restored_records_count integer DEFAULT 0,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processor_run_id text,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT system_restore_requests_mode_check CHECK ((restore_mode = 'Safe Missing Records'::text)),
    CONSTRAINT system_restore_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Previewed'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text, 'Cancelled'::text])))
);


--
-- Name: talent_candidate_certifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidate_certifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    certification_name text NOT NULL,
    issuing_organization text,
    issue_date date,
    expiry_date date,
    credential_id text,
    credential_url text,
    source text DEFAULT 'Candidate'::text NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_certification_date_check CHECK (((expiry_date IS NULL) OR (issue_date IS NULL) OR (expiry_date >= issue_date))),
    CONSTRAINT talent_certification_source_check CHECK ((source = ANY (ARRAY['Candidate'::text, 'CV AI'::text, 'Human Review'::text])))
);


--
-- Name: talent_candidate_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidate_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    consent_type text NOT NULL,
    consent_version text DEFAULT '1.0'::text NOT NULL,
    is_granted boolean NOT NULL,
    granted_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    source text DEFAULT 'Candidate Portal'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_consents_time_check CHECK (((withdrawn_at IS NULL) OR (granted_at IS NULL) OR (withdrawn_at >= granted_at))),
    CONSTRAINT talent_consents_type_check CHECK ((consent_type = ANY (ARRAY['Platform Terms'::text, 'Privacy Policy'::text, 'Employer Sharing'::text, 'AI CV Analysis'::text, 'AI Interview'::text, 'Evaluation Email'::text, 'Marketing Communications'::text])))
);


--
-- Name: talent_candidate_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidate_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    document_type text DEFAULT 'CV'::text NOT NULL,
    file_name text NOT NULL,
    storage_bucket text DEFAULT 'talent-cv'::text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    is_primary boolean DEFAULT true NOT NULL,
    parse_status text DEFAULT 'Pending'::text NOT NULL,
    extracted_text text,
    parsed_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    parse_error text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_documents_parse_status_check CHECK ((parse_status = ANY (ARRAY['Pending'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text]))),
    CONSTRAINT talent_documents_size_check CHECK (((size_bytes IS NULL) OR (size_bytes >= 0))),
    CONSTRAINT talent_documents_type_check CHECK ((document_type = ANY (ARRAY['CV'::text, 'Cover Letter'::text, 'Certificate'::text, 'License'::text, 'ID'::text, 'Other'::text])))
);


--
-- Name: talent_candidate_education; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidate_education (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    institution_name text NOT NULL,
    qualification text,
    major text,
    country text,
    start_date date,
    graduation_date date,
    grade text,
    source text DEFAULT 'Candidate'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_education_date_check CHECK (((graduation_date IS NULL) OR (start_date IS NULL) OR (graduation_date >= start_date))),
    CONSTRAINT talent_education_source_check CHECK ((source = ANY (ARRAY['Candidate'::text, 'CV AI'::text, 'Human Review'::text])))
);


--
-- Name: talent_candidate_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidate_events (
    id bigint NOT NULL,
    candidate_id uuid,
    auth_user_id uuid,
    event_name text NOT NULL,
    event_source text DEFAULT 'Candidate Portal'::text NOT NULL,
    session_key text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: talent_candidate_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.talent_candidate_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: talent_candidate_experience; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidate_experience (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    employer_name text,
    job_title text NOT NULL,
    country text,
    city text,
    start_date date,
    end_date date,
    is_current boolean DEFAULT false NOT NULL,
    description text,
    achievements text,
    source text DEFAULT 'Candidate'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_experience_date_check CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT talent_experience_source_check CHECK ((source = ANY (ARRAY['Candidate'::text, 'CV AI'::text, 'Human Review'::text])))
);


--
-- Name: talent_candidate_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidate_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    skill_name text NOT NULL,
    skill_category text,
    proficiency_level text,
    years_experience numeric(5,2),
    source text DEFAULT 'Candidate'::text NOT NULL,
    confidence numeric(5,2),
    is_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_skills_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (100)::numeric)))),
    CONSTRAINT talent_skills_proficiency_check CHECK (((proficiency_level IS NULL) OR (proficiency_level = ANY (ARRAY['Beginner'::text, 'Intermediate'::text, 'Advanced'::text, 'Expert'::text])))),
    CONSTRAINT talent_skills_source_check CHECK ((source = ANY (ARRAY['Candidate'::text, 'CV AI'::text, 'Interview AI'::text, 'Human Review'::text])))
);


--
-- Name: talent_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid NOT NULL,
    public_reference text DEFAULT ('VF-TAL-'::text || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 10))) NOT NULL,
    email text,
    full_name text,
    phone text,
    nationality text,
    country_of_residence text,
    city text,
    profession text,
    headline text,
    professional_summary text,
    years_experience numeric(5,2),
    current_company text,
    current_job_title text,
    availability_status text DEFAULT 'Open to Opportunities'::text NOT NULL,
    notice_period_days integer,
    expected_salary numeric(14,2),
    expected_salary_currency text DEFAULT 'SAR'::text,
    preferred_locations jsonb DEFAULT '[]'::jsonb NOT NULL,
    preferred_employment_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    languages jsonb DEFAULT '[]'::jsonb NOT NULL,
    linkedin_url text,
    portfolio_url text,
    profile_photo_path text,
    profile_visibility text DEFAULT 'Private'::text NOT NULL,
    marketplace_status text DEFAULT 'Draft'::text NOT NULL,
    employer_sharing_consent boolean DEFAULT false NOT NULL,
    ai_cv_status text DEFAULT 'Not Uploaded'::text NOT NULL,
    ai_cv_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_interview_status text DEFAULT 'Not Invited'::text NOT NULL,
    latest_ai_interview_session_id uuid,
    latest_ai_interview_score numeric(6,2),
    latest_ai_recommendation text,
    profile_completeness integer DEFAULT 0 NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    submitted_at timestamp with time zone,
    published_at timestamp with time zone,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_candidates_ai_cv_status_check CHECK ((ai_cv_status = ANY (ARRAY['Not Uploaded'::text, 'Pending'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text]))),
    CONSTRAINT talent_candidates_ai_interview_status_check CHECK ((ai_interview_status = ANY (ARRAY['Not Invited'::text, 'Invited'::text, 'Opened'::text, 'In Progress'::text, 'Completed'::text, 'Failed'::text]))),
    CONSTRAINT talent_candidates_marketplace_status_check CHECK ((marketplace_status = ANY (ARRAY['Draft'::text, 'Submitted'::text, 'Under Review'::text, 'Approved'::text, 'Rejected'::text, 'Suspended'::text]))),
    CONSTRAINT talent_candidates_notice_period_check CHECK (((notice_period_days IS NULL) OR ((notice_period_days >= 0) AND (notice_period_days <= 730)))),
    CONSTRAINT talent_candidates_profile_completeness_check CHECK (((profile_completeness >= 0) AND (profile_completeness <= 100))),
    CONSTRAINT talent_candidates_visibility_check CHECK ((profile_visibility = ANY (ARRAY['Private'::text, 'Anonymized'::text, 'Public'::text]))),
    CONSTRAINT talent_candidates_years_experience_check CHECK (((years_experience IS NULL) OR ((years_experience >= (0)::numeric) AND (years_experience <= (80)::numeric))))
);


--
-- Name: talent_cv_analysis_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_cv_analysis_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    document_id uuid NOT NULL,
    status text DEFAULT 'Queued'::text NOT NULL,
    model_name text,
    attempt_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    result_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_cv_analysis_runs_status_check CHECK ((status = ANY (ARRAY['Queued'::text, 'Processing'::text, 'Completed'::text, 'Failed'::text])))
);


--
-- Name: talent_resume_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.talent_resume_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    source_document_id uuid,
    version_number integer NOT NULL,
    version_type text DEFAULT 'AI Optimized'::text NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'Processing'::text NOT NULL,
    language text DEFAULT 'English'::text NOT NULL,
    model_name text,
    source_score integer,
    optimized_score integer,
    source_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    optimized_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    resume_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    improvements jsonb DEFAULT '[]'::jsonb NOT NULL,
    pdf_storage_path text,
    docx_storage_path text,
    html_storage_path text,
    is_primary boolean DEFAULT false NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT talent_resume_versions_status_check CHECK ((status = ANY (ARRAY['Processing'::text, 'Completed'::text, 'Failed'::text]))),
    CONSTRAINT talent_resume_versions_type_check CHECK ((version_type = ANY (ARRAY['Original'::text, 'AI Optimized'::text, 'ATS'::text, 'Executive'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password text,
    role text DEFAULT 'Viewer'::text NOT NULL,
    agency_name text,
    status text DEFAULT 'Active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    last_login timestamp without time zone,
    company_id uuid,
    finance_role text,
    agency_id uuid,
    auth_user_id uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: visa_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_allocations (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_no text,
    visa_no text,
    allocated_qty bigint,
    company_id uuid,
    visa_batch_line_id bigint,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text
);


--
-- Name: visa_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.visa_allocations ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.visa_allocations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: visa_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_authorizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visa_id uuid DEFAULT gen_random_uuid() NOT NULL,
    visa_no text,
    authorization_no text,
    agency text,
    office_country text,
    allocated_qty bigint,
    received_candidates bigint,
    interview_passed bigint,
    mobilized bigint,
    status text,
    created_at timestamp with time zone,
    request_no text,
    cancellation_no text,
    cancelled_at date,
    company_id uuid,
    profession text,
    nationality text,
    gender text,
    visa_allocation_id bigint,
    visa_batch_line_id bigint,
    created_by_name text,
    created_by_email text,
    created_by_role text,
    updated_by_name text,
    updated_by_email text,
    updated_by_role text
);


--
-- Name: visa_batch_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_batch_lines (
    id bigint NOT NULL,
    company_id uuid,
    visa_batch_id uuid NOT NULL,
    visa_no text,
    line_no integer,
    profession text,
    nationality text,
    gender text,
    quantity integer DEFAULT 0,
    allocated_qty integer DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: visa_batch_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.visa_batch_lines ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.visa_batch_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: visa_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visa_no text NOT NULL,
    issue_date date,
    project text,
    profession text,
    gender text,
    nationality text,
    quantity integer DEFAULT 0 NOT NULL,
    authorized integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'Authorized'::text,
    agency text DEFAULT 'Noman'::text,
    request_no text,
    updated_at timestamp with time zone DEFAULT now(),
    moi_no text,
    expiry_date date,
    allocated_qty bigint,
    remaining_qty bigint,
    authorization_no text,
    office_country text,
    notes text,
    company_id uuid
);


--
-- Name: local_content_project_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_content_project_targets ALTER COLUMN id SET DEFAULT nextval('public.local_content_project_targets_id_seq'::regclass);


--
-- Name: marketplace_deal_workers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_deal_workers ALTER COLUMN id SET DEFAULT nextval('public.marketplace_deal_workers_id_seq'::regclass);


--
-- Name: notification_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events ALTER COLUMN id SET DEFAULT nextval('public.notification_events_id_seq'::regclass);


--
-- Name: agencies agencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_pkey PRIMARY KEY (id);


--
-- Name: agency_agreements agency_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_agreements
    ADD CONSTRAINT agency_agreements_pkey PRIMARY KEY (id);


--
-- Name: agency_client_access agency_client_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_client_access
    ADD CONSTRAINT agency_client_access_pkey PRIMARY KEY (id);


--
-- Name: agency_company_user_access agency_company_user_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_company_user_access
    ADD CONSTRAINT agency_company_user_access_pkey PRIMARY KEY (id);


--
-- Name: agency_company_user_access agency_company_user_access_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_company_user_access
    ADD CONSTRAINT agency_company_user_access_unique UNIQUE (company_id, agency_id, user_id);


--
-- Name: agency_members agency_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_members
    ADD CONSTRAINT agency_members_pkey PRIMARY KEY (id);


--
-- Name: agency_members agency_members_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_members
    ADD CONSTRAINT agency_members_unique UNIQUE (agency_id, user_id);


--
-- Name: agency_penalties agency_penalties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_penalties
    ADD CONSTRAINT agency_penalties_pkey PRIMARY KEY (id);


--
-- Name: agency_score_history agency_score_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_score_history
    ADD CONSTRAINT agency_score_history_pkey PRIMARY KEY (id);


--
-- Name: agency_scores agency_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_scores
    ADD CONSTRAINT agency_scores_pkey PRIMARY KEY (id);


--
-- Name: ai_agent_action_locks ai_agent_action_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_action_locks
    ADD CONSTRAINT ai_agent_action_locks_pkey PRIMARY KEY (company_id, action_key);


--
-- Name: ai_agent_audit_logs ai_agent_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_audit_logs
    ADD CONSTRAINT ai_agent_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_agent_jobs ai_agent_jobs_company_id_job_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_jobs
    ADD CONSTRAINT ai_agent_jobs_company_id_job_key_key UNIQUE (company_id, job_key);


--
-- Name: ai_agent_jobs ai_agent_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_jobs
    ADD CONSTRAINT ai_agent_jobs_pkey PRIMARY KEY (id);


--
-- Name: ai_agent_settings ai_agent_settings_company_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_settings
    ADD CONSTRAINT ai_agent_settings_company_id_key UNIQUE (company_id);


--
-- Name: ai_agent_settings ai_agent_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_settings
    ADD CONSTRAINT ai_agent_settings_pkey PRIMARY KEY (id);


--
-- Name: ai_agent_worker_runs ai_agent_worker_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_worker_runs
    ADD CONSTRAINT ai_agent_worker_runs_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_analysis_jobs ai_interview_analysis_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_analysis_jobs
    ADD CONSTRAINT ai_interview_analysis_jobs_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_answers ai_interview_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_answers
    ADD CONSTRAINT ai_interview_answers_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_campaign_candidates ai_interview_campaign_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaign_candidates
    ADD CONSTRAINT ai_interview_campaign_candidates_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_campaigns ai_interview_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaigns
    ADD CONSTRAINT ai_interview_campaigns_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_conversation_turns ai_interview_conversation_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_conversation_turns
    ADD CONSTRAINT ai_interview_conversation_turns_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_conversation_turns ai_interview_conversation_turns_session_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_conversation_turns
    ADD CONSTRAINT ai_interview_conversation_turns_session_order_key UNIQUE (session_id, turn_order);


--
-- Name: ai_interview_generation_runs ai_interview_generation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_generation_runs
    ADD CONSTRAINT ai_interview_generation_runs_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_invitation_jobs ai_interview_invitation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_invitation_jobs
    ADD CONSTRAINT ai_interview_invitation_jobs_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_questions ai_interview_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_questions
    ADD CONSTRAINT ai_interview_questions_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_session_events ai_interview_session_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_session_events
    ADD CONSTRAINT ai_interview_session_events_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_sessions ai_interview_sessions_access_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_access_token_key UNIQUE (access_token);


--
-- Name: ai_interview_sessions ai_interview_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_pkey PRIMARY KEY (id);


--
-- Name: ai_interview_templates ai_interview_templates_company_id_template_name_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_templates
    ADD CONSTRAINT ai_interview_templates_company_id_template_name_version_key UNIQUE (company_id, template_name, version);


--
-- Name: ai_interview_templates ai_interview_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_templates
    ADD CONSTRAINT ai_interview_templates_pkey PRIMARY KEY (id);


--
-- Name: candidate_technical_profiles candidate_technical_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_technical_profiles
    ADD CONSTRAINT candidate_technical_profiles_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_saudi_civil_id_required; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.candidates
    ADD CONSTRAINT candidates_saudi_civil_id_required CHECK (((NOT ((lower(COALESCE(nationality, ''::text)) ~~ '%saudi%'::text) OR (COALESCE(nationality, ''::text) ~~ '%ط·آ·ط¢آ³ط·آ·ط¢آ¹ط·آ¸ط«â€ ط·آ·ط¢آ¯%'::text))) OR ((NULLIF(btrim(COALESCE(civil_id_no, ''::text)), ''::text) IS NOT NULL) AND (civil_id_expiry_date IS NOT NULL)))) NOT VALID;


--
-- Name: collections collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_agency_access company_agency_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_agency_access
    ADD CONSTRAINT company_agency_access_pkey PRIMARY KEY (id);


--
-- Name: company_agency_access company_agency_access_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_agency_access
    ADD CONSTRAINT company_agency_access_unique UNIQUE (company_id, agency_id);


--
-- Name: company_agency_users company_agency_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_agency_users
    ADD CONSTRAINT company_agency_users_pkey PRIMARY KEY (id);


--
-- Name: company_agency_users company_agency_users_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_agency_users
    ADD CONSTRAINT company_agency_users_unique UNIQUE (company_id, agency_id, user_id);


--
-- Name: company_email_settings company_email_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_email_settings
    ADD CONSTRAINT company_email_settings_pkey PRIMARY KEY (id);


--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (id);


--
-- Name: demobilizations demobilizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demobilizations
    ADD CONSTRAINT demobilizations_pkey PRIMARY KEY (id);


--
-- Name: education_institutions education_institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_institutions
    ADD CONSTRAINT education_institutions_pkey PRIMARY KEY (id);


--
-- Name: email_logs email_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: interviews interviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: local_content_project_targets local_content_project_targets_company_id_project_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_content_project_targets
    ADD CONSTRAINT local_content_project_targets_company_id_project_name_key UNIQUE (company_id, project_name);


--
-- Name: local_content_project_targets local_content_project_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_content_project_targets
    ADD CONSTRAINT local_content_project_targets_pkey PRIMARY KEY (id);


--
-- Name: local_content_settings local_content_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_content_settings
    ADD CONSTRAINT local_content_settings_pkey PRIMARY KEY (company_id);


--
-- Name: marketplace_deal_workers marketplace_deal_workers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_deal_workers
    ADD CONSTRAINT marketplace_deal_workers_pkey PRIMARY KEY (id);


--
-- Name: marketplace_deals marketplace_deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_deals
    ADD CONSTRAINT marketplace_deals_pkey PRIMARY KEY (id);


--
-- Name: marketplace_requests marketplace_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_requests
    ADD CONSTRAINT marketplace_requests_pkey PRIMARY KEY (id);


--
-- Name: mobilizations mobilizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobilizations
    ADD CONSTRAINT mobilizations_pkey PRIMARY KEY (id);


--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);


--
-- Name: onboarding_validations onboarding_validations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_validations
    ADD CONSTRAINT onboarding_validations_pkey PRIMARY KEY (id);


--
-- Name: onboarding_validations onboarding_validations_unique_candidate; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_validations
    ADD CONSTRAINT onboarding_validations_unique_candidate UNIQUE (company_id, candidate_id);


--
-- Name: platform_clients platform_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_clients
    ADD CONSTRAINT platform_clients_pkey PRIMARY KEY (id);


--
-- Name: profession_aliases profession_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profession_aliases
    ADD CONSTRAINT profession_aliases_pkey PRIMARY KEY (id);


--
-- Name: professions professions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professions
    ADD CONSTRAINT professions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: request_audit_logs request_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_audit_logs
    ADD CONSTRAINT request_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: request_lines request_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_lines
    ADD CONSTRAINT request_lines_pkey PRIMARY KEY (id);


--
-- Name: requests requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_pkey PRIMARY KEY (id);


--
-- Name: subscription_invoices subscription_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: system_activity_logs system_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_activity_logs
    ADD CONSTRAINT system_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: system_backups system_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_backups
    ADD CONSTRAINT system_backups_pkey PRIMARY KEY (id);


--
-- Name: system_restore_requests system_restore_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_restore_requests
    ADD CONSTRAINT system_restore_requests_pkey PRIMARY KEY (id);


--
-- Name: talent_candidate_certifications talent_candidate_certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_certifications
    ADD CONSTRAINT talent_candidate_certifications_pkey PRIMARY KEY (id);


--
-- Name: talent_candidate_consents talent_candidate_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_consents
    ADD CONSTRAINT talent_candidate_consents_pkey PRIMARY KEY (id);


--
-- Name: talent_candidate_documents talent_candidate_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_documents
    ADD CONSTRAINT talent_candidate_documents_pkey PRIMARY KEY (id);


--
-- Name: talent_candidate_education talent_candidate_education_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_education
    ADD CONSTRAINT talent_candidate_education_pkey PRIMARY KEY (id);


--
-- Name: talent_candidate_events talent_candidate_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_events
    ADD CONSTRAINT talent_candidate_events_pkey PRIMARY KEY (id);


--
-- Name: talent_candidate_experience talent_candidate_experience_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_experience
    ADD CONSTRAINT talent_candidate_experience_pkey PRIMARY KEY (id);


--
-- Name: talent_candidate_skills talent_candidate_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_skills
    ADD CONSTRAINT talent_candidate_skills_pkey PRIMARY KEY (id);


--
-- Name: talent_candidates talent_candidates_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidates
    ADD CONSTRAINT talent_candidates_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: talent_candidates talent_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidates
    ADD CONSTRAINT talent_candidates_pkey PRIMARY KEY (id);


--
-- Name: talent_candidates talent_candidates_public_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidates
    ADD CONSTRAINT talent_candidates_public_reference_key UNIQUE (public_reference);


--
-- Name: talent_cv_analysis_runs talent_cv_analysis_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_cv_analysis_runs
    ADD CONSTRAINT talent_cv_analysis_runs_pkey PRIMARY KEY (id);


--
-- Name: talent_resume_versions talent_resume_versions_candidate_id_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_resume_versions
    ADD CONSTRAINT talent_resume_versions_candidate_id_version_number_key UNIQUE (candidate_id, version_number);


--
-- Name: talent_resume_versions talent_resume_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_resume_versions
    ADD CONSTRAINT talent_resume_versions_pkey PRIMARY KEY (id);


--
-- Name: users users_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visa_allocations visa_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_allocations
    ADD CONSTRAINT visa_allocations_pkey PRIMARY KEY (id);


--
-- Name: visa_authorizations visa_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_authorizations
    ADD CONSTRAINT visa_authorizations_pkey PRIMARY KEY (id);


--
-- Name: visa_batch_lines visa_batch_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_batch_lines
    ADD CONSTRAINT visa_batch_lines_pkey PRIMARY KEY (id);


--
-- Name: visa_batches visa_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_batches
    ADD CONSTRAINT visa_batches_pkey PRIMARY KEY (id);


--
-- Name: agencies_unique_normalized_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agencies_unique_normalized_name ON public.agencies USING btree (lower(TRIM(BOTH FROM name))) WHERE (name IS NOT NULL);


--
-- Name: agency_agreements_company_agreement_no_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agency_agreements_company_agreement_no_unique ON public.agency_agreements USING btree (company_id, agreement_no);


--
-- Name: agency_company_user_access_unique_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agency_company_user_access_unique_active_idx ON public.agency_company_user_access USING btree (company_id, agency_id, user_id) WHERE (COALESCE(status, 'Active'::text) = 'Active'::text);


--
-- Name: ai_interview_campaign_candidates_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_campaign_candidates_campaign_idx ON public.ai_interview_campaign_candidates USING btree (campaign_id, created_at);


--
-- Name: ai_interview_campaign_candidates_company_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_campaign_candidates_company_status_idx ON public.ai_interview_campaign_candidates USING btree (company_id, status);


--
-- Name: ai_interview_campaign_candidates_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_campaign_candidates_session_idx ON public.ai_interview_campaign_candidates USING btree (session_id);


--
-- Name: ai_interview_campaign_candidates_unique_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_interview_campaign_candidates_unique_candidate_idx ON public.ai_interview_campaign_candidates USING btree (campaign_id, candidate_id) WHERE (candidate_id IS NOT NULL);


--
-- Name: ai_interview_campaign_candidates_unique_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_interview_campaign_candidates_unique_email_idx ON public.ai_interview_campaign_candidates USING btree (campaign_id, lower(candidate_email)) WHERE (btrim(candidate_email) <> ''::text);


--
-- Name: ai_interview_campaigns_company_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_campaigns_company_created_idx ON public.ai_interview_campaigns USING btree (company_id, created_at DESC);


--
-- Name: ai_interview_campaigns_company_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_campaigns_company_status_idx ON public.ai_interview_campaigns USING btree (company_id, status);


--
-- Name: ai_interview_campaigns_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_campaigns_template_idx ON public.ai_interview_campaigns USING btree (template_id);


--
-- Name: ai_interview_invitation_jobs_active_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_interview_invitation_jobs_active_unique_idx ON public.ai_interview_invitation_jobs USING btree (campaign_candidate_id, job_type) WHERE (status = ANY (ARRAY['Queued'::text, 'Processing'::text]));


--
-- Name: ai_interview_invitation_jobs_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_invitation_jobs_campaign_idx ON public.ai_interview_invitation_jobs USING btree (campaign_id, created_at);


--
-- Name: ai_interview_invitation_jobs_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_invitation_jobs_candidate_idx ON public.ai_interview_invitation_jobs USING btree (campaign_candidate_id);


--
-- Name: ai_interview_invitation_jobs_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_invitation_jobs_queue_idx ON public.ai_interview_invitation_jobs USING btree (status, available_at, priority, created_at);


--
-- Name: ai_interview_sessions_campaign_candidate_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_interview_sessions_campaign_candidate_unique_idx ON public.ai_interview_sessions USING btree (campaign_candidate_id) WHERE (campaign_candidate_id IS NOT NULL);


--
-- Name: ai_interview_sessions_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_sessions_campaign_idx ON public.ai_interview_sessions USING btree (campaign_id, created_at DESC);


--
-- Name: ai_interview_templates_current_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_interview_templates_current_version_idx ON public.ai_interview_templates USING btree (template_group_id, is_current_version);


--
-- Name: ai_interview_templates_group_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_interview_templates_group_version_uidx ON public.ai_interview_templates USING btree (template_group_id, version_number);


--
-- Name: company_agency_access_unique_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX company_agency_access_unique_active_idx ON public.company_agency_access USING btree (company_id, agency_id) WHERE (COALESCE(status, 'Active'::text) = 'Active'::text);


--
-- Name: idx_agency_agreements_agency_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_agreements_agency_name ON public.agency_agreements USING btree (agency_name);


--
-- Name: idx_agency_agreements_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_agreements_company_id ON public.agency_agreements USING btree (company_id);


--
-- Name: idx_agency_agreements_sent_to_agency_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_agreements_sent_to_agency_at ON public.agency_agreements USING btree (sent_to_agency_at);


--
-- Name: idx_agency_agreements_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_agreements_status ON public.agency_agreements USING btree (status);


--
-- Name: idx_agency_client_access_agency_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_client_access_agency_id ON public.agency_client_access USING btree (agency_id);


--
-- Name: idx_agency_client_access_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_client_access_company_id ON public.agency_client_access USING btree (company_id);


--
-- Name: idx_agency_client_access_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_client_access_status ON public.agency_client_access USING btree (status);


--
-- Name: idx_agency_client_access_user_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_client_access_user_email ON public.agency_client_access USING btree (lower(user_email));


--
-- Name: idx_agency_client_access_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_client_access_user_id ON public.agency_client_access USING btree (user_id);


--
-- Name: idx_agency_penalties_agency_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_penalties_agency_name ON public.agency_penalties USING btree (agency_name);


--
-- Name: idx_agency_penalties_agreement_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_penalties_agreement_no ON public.agency_penalties USING btree (agreement_no);


--
-- Name: idx_agency_penalties_candidate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_penalties_candidate_id ON public.agency_penalties USING btree (candidate_id);


--
-- Name: idx_agency_penalties_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_penalties_company_id ON public.agency_penalties USING btree (company_id);


--
-- Name: idx_agency_penalties_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_penalties_status ON public.agency_penalties USING btree (status);


--
-- Name: idx_agency_score_history_agency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_score_history_agency ON public.agency_score_history USING btree (agency_id);


--
-- Name: idx_agency_score_history_agreement_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_score_history_agreement_no ON public.agency_score_history USING btree (agreement_no);


--
-- Name: idx_agency_score_history_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_score_history_company ON public.agency_score_history USING btree (company_id);


--
-- Name: idx_agency_score_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_score_history_created ON public.agency_score_history USING btree (created_at DESC);


--
-- Name: idx_agency_scores_agreement_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_scores_agreement_no ON public.agency_scores USING btree (agreement_no);


--
-- Name: idx_ai_agent_audit_action_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_audit_action_key ON public.ai_agent_audit_logs USING btree (company_id, action_key, created_at DESC);


--
-- Name: idx_ai_agent_audit_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_audit_company_created ON public.ai_agent_audit_logs USING btree (company_id, created_at DESC);


--
-- Name: idx_ai_agent_audit_hour_rate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_audit_hour_rate ON public.ai_agent_audit_logs USING btree (company_id, actor, status, created_at DESC);


--
-- Name: idx_ai_agent_audit_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_audit_status ON public.ai_agent_audit_logs USING btree (company_id, status, created_at DESC);


--
-- Name: idx_ai_agent_jobs_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_jobs_company_created ON public.ai_agent_jobs USING btree (company_id, created_at DESC);


--
-- Name: idx_ai_agent_jobs_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_jobs_queue ON public.ai_agent_jobs USING btree (status, scheduled_for, priority DESC, created_at);


--
-- Name: idx_ai_agent_jobs_worker_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_jobs_worker_claim ON public.ai_agent_jobs USING btree (status, scheduled_for, priority DESC, created_at) WHERE (status = 'queued'::text);


--
-- Name: idx_ai_agent_locks_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_locks_company_status ON public.ai_agent_action_locks USING btree (company_id, status, locked_until);


--
-- Name: idx_ai_agent_locks_related; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_locks_related ON public.ai_agent_action_locks USING btree (company_id, related_table, related_id);


--
-- Name: idx_ai_agent_worker_runs_company_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agent_worker_runs_company_started ON public.ai_agent_worker_runs USING btree (company_id, started_at DESC);


--
-- Name: idx_ai_answers_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_answers_company ON public.ai_interview_answers USING btree (company_id);


--
-- Name: idx_ai_answers_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_answers_session ON public.ai_interview_answers USING btree (session_id);


--
-- Name: idx_ai_answers_session_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_answers_session_order ON public.ai_interview_answers USING btree (session_id, question_order);


--
-- Name: idx_ai_generation_runs_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_generation_runs_company ON public.ai_interview_generation_runs USING btree (company_id);


--
-- Name: idx_ai_generation_runs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_generation_runs_created_at ON public.ai_interview_generation_runs USING btree (created_at DESC);


--
-- Name: idx_ai_generation_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_generation_runs_status ON public.ai_interview_generation_runs USING btree (company_id, status);


--
-- Name: idx_ai_generation_runs_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_generation_runs_template ON public.ai_interview_generation_runs USING btree (template_id);


--
-- Name: idx_ai_interview_analysis_jobs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_analysis_jobs_session ON public.ai_interview_analysis_jobs USING btree (session_id, created_at DESC);


--
-- Name: idx_ai_interview_analysis_jobs_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_analysis_jobs_worker ON public.ai_interview_analysis_jobs USING btree (status, available_at, priority, created_at);


--
-- Name: idx_ai_interview_answers_answer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_answers_answer_status ON public.ai_interview_answers USING btree (answer_status, session_id, question_order);


--
-- Name: idx_ai_interview_answers_transcription_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_answers_transcription_queue ON public.ai_interview_answers USING btree (transcription_status, session_id, question_order);


--
-- Name: idx_ai_interview_answers_video; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_answers_video ON public.ai_interview_answers USING btree (session_id, video_upload_status);


--
-- Name: idx_ai_interview_conversation_turns_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_conversation_turns_company ON public.ai_interview_conversation_turns USING btree (company_id, created_at DESC);


--
-- Name: idx_ai_interview_conversation_turns_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_conversation_turns_session ON public.ai_interview_conversation_turns USING btree (session_id, turn_order);


--
-- Name: idx_ai_interview_questions_is_global; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_questions_is_global ON public.ai_interview_questions USING btree (is_global);


--
-- Name: idx_ai_interview_session_events_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_session_events_company ON public.ai_interview_session_events USING btree (company_id, event_at DESC);


--
-- Name: idx_ai_interview_session_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_session_events_session ON public.ai_interview_session_events USING btree (session_id, event_at DESC);


--
-- Name: idx_ai_interview_sessions_analysis_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_sessions_analysis_status ON public.ai_interview_sessions USING btree (analysis_status, completed_at DESC);


--
-- Name: idx_ai_interview_sessions_delivery_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_sessions_delivery_mode ON public.ai_interview_sessions USING btree (company_id, interaction_mode, interview_mode, camera_mode);


--
-- Name: idx_ai_interview_sessions_evaluation_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_sessions_evaluation_email ON public.ai_interview_sessions USING btree (evaluation_email_status, evaluation_email_consent, analysis_status);


--
-- Name: idx_ai_interview_sessions_realtime_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_sessions_realtime_status ON public.ai_interview_sessions USING btree (realtime_connection_status, status);


--
-- Name: idx_ai_interview_templates_is_global; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_interview_templates_is_global ON public.ai_interview_templates USING btree (is_global);


--
-- Name: idx_ai_questions_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_questions_company ON public.ai_interview_questions USING btree (company_id);


--
-- Name: idx_ai_questions_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_questions_template ON public.ai_interview_questions USING btree (template_id);


--
-- Name: idx_ai_questions_template_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_questions_template_order ON public.ai_interview_questions USING btree (template_id, question_order);


--
-- Name: idx_ai_sessions_access_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_sessions_access_token ON public.ai_interview_sessions USING btree (access_token);


--
-- Name: idx_ai_sessions_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_sessions_candidate ON public.ai_interview_sessions USING btree (company_id, candidate_id);


--
-- Name: idx_ai_sessions_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_sessions_company ON public.ai_interview_sessions USING btree (company_id);


--
-- Name: idx_ai_sessions_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_sessions_company_status ON public.ai_interview_sessions USING btree (company_id, status);


--
-- Name: idx_ai_sessions_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_sessions_request ON public.ai_interview_sessions USING btree (company_id, request_no);


--
-- Name: idx_ai_templates_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_templates_company ON public.ai_interview_templates USING btree (company_id);


--
-- Name: idx_ai_templates_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_templates_company_status ON public.ai_interview_templates USING btree (company_id, status, is_active);


--
-- Name: idx_ai_templates_profession_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_templates_profession_approval ON public.ai_interview_templates USING btree (company_id, profession, approval_status, is_active);


--
-- Name: idx_ai_templates_request_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_templates_request_line ON public.ai_interview_templates USING btree (company_id, request_line_id);


--
-- Name: idx_ai_templates_request_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_templates_request_no ON public.ai_interview_templates USING btree (company_id, request_no);


--
-- Name: idx_ai_templates_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_templates_source_type ON public.ai_interview_templates USING btree (company_id, source_type);


--
-- Name: idx_candidate_technical_profiles_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidate_technical_profiles_company ON public.candidate_technical_profiles USING btree (company_id);


--
-- Name: idx_candidate_technical_profiles_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidate_technical_profiles_request ON public.candidate_technical_profiles USING btree (company_id, request_no);


--
-- Name: idx_candidate_technical_profiles_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidate_technical_profiles_score ON public.candidate_technical_profiles USING btree (company_id, final_ai_score DESC);


--
-- Name: idx_candidates_contract_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidates_contract_status ON public.candidates USING btree (contract_status);


--
-- Name: idx_candidates_request_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidates_request_no ON public.candidates USING btree (request_no);


--
-- Name: idx_candidates_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidates_status ON public.candidates USING btree (status);


--
-- Name: idx_company_email_settings_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_company_email_settings_company_id ON public.company_email_settings USING btree (company_id);


--
-- Name: idx_education_institutions_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_education_institutions_company ON public.education_institutions USING btree (company_id);


--
-- Name: idx_education_institutions_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_education_institutions_country ON public.education_institutions USING btree (country);


--
-- Name: idx_education_institutions_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_education_institutions_name ON public.education_institutions USING btree (institution_name);


--
-- Name: idx_email_logs_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_company_created ON public.email_logs USING btree (company_id, created_at DESC);


--
-- Name: idx_email_logs_company_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_company_id_created_at ON public.email_logs USING btree (company_id, created_at DESC);


--
-- Name: idx_email_logs_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_company_status ON public.email_logs USING btree (company_id, status);


--
-- Name: idx_email_logs_company_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_company_type ON public.email_logs USING btree (company_id, type);


--
-- Name: idx_email_logs_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_event_type ON public.email_logs USING btree (event_type);


--
-- Name: idx_email_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_status ON public.email_logs USING btree (status);


--
-- Name: idx_email_templates_company_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_company_active ON public.email_templates USING btree (company_id, is_active);


--
-- Name: idx_email_templates_company_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_company_category ON public.email_templates USING btree (company_id, category);


--
-- Name: idx_email_templates_company_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_templates_company_key_unique ON public.email_templates USING btree (company_id, template_key);


--
-- Name: idx_local_content_project_targets_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_content_project_targets_company ON public.local_content_project_targets USING btree (company_id);


--
-- Name: idx_local_content_project_targets_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_content_project_targets_project ON public.local_content_project_targets USING btree (project_name);


--
-- Name: idx_marketplace_deal_workers_company_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_deal_workers_company_deal ON public.marketplace_deal_workers USING btree (company_id, deal_id);


--
-- Name: idx_marketplace_deal_workers_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_deal_workers_employee ON public.marketplace_deal_workers USING btree (company_id, employee_id);


--
-- Name: idx_marketplace_deals_agreement_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_deals_agreement_no ON public.marketplace_deals USING btree (agreement_no);


--
-- Name: idx_marketplace_deals_company_deal_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_deals_company_deal_type ON public.marketplace_deals USING btree (company_id, deal_type);


--
-- Name: idx_marketplace_requests_company_deal_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_requests_company_deal_type ON public.marketplace_requests USING btree (company_id, deal_type);


--
-- Name: idx_notification_events_ai_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_ai_dedupe ON public.notification_events USING btree (company_id, type, related_table, related_id, created_at DESC);


--
-- Name: idx_notification_events_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_company_created ON public.notification_events USING btree (company_id, created_at DESC);


--
-- Name: idx_notification_events_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_company_status ON public.notification_events USING btree (company_id, status);


--
-- Name: idx_notification_events_company_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_company_type ON public.notification_events USING btree (company_id, type);


--
-- Name: idx_notification_events_delivery_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_delivery_status ON public.notification_events USING btree (delivery_status);


--
-- Name: idx_notification_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_events_status ON public.notification_events USING btree (status);


--
-- Name: idx_onboarding_validations_agency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_validations_agency ON public.onboarding_validations USING btree (company_id, agency_name);


--
-- Name: idx_onboarding_validations_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_validations_candidate ON public.onboarding_validations USING btree (candidate_id);


--
-- Name: idx_onboarding_validations_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_validations_company ON public.onboarding_validations USING btree (company_id);


--
-- Name: idx_onboarding_validations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_validations_status ON public.onboarding_validations USING btree (company_id, status);


--
-- Name: idx_profession_aliases_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profession_aliases_company_id ON public.profession_aliases USING btree (company_id);


--
-- Name: idx_profession_aliases_normalized_alias; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profession_aliases_normalized_alias ON public.profession_aliases USING btree (normalized_alias);


--
-- Name: idx_profession_aliases_profession_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profession_aliases_profession_id ON public.profession_aliases USING btree (profession_id);


--
-- Name: idx_requests_company_project_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requests_company_project_no ON public.requests USING btree (company_id, project_no);


--
-- Name: idx_users_agency_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_agency_id ON public.users USING btree (agency_id);


--
-- Name: idx_users_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_auth_user_id ON public.users USING btree (auth_user_id);


--
-- Name: idx_users_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_company_id ON public.users USING btree (company_id);


--
-- Name: idx_users_role_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role_status ON public.users USING btree (role, status);


--
-- Name: notification_events_company_dedupe_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_events_company_dedupe_key_unique ON public.notification_events USING btree (company_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: requests_request_no_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX requests_request_no_unique ON public.requests USING btree (request_no) WHERE (request_no IS NOT NULL);


--
-- Name: system_activity_logs_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_activity_logs_company_id_idx ON public.system_activity_logs USING btree (company_id);


--
-- Name: system_activity_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_activity_logs_created_at_idx ON public.system_activity_logs USING btree (created_at DESC);


--
-- Name: system_activity_logs_module_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_activity_logs_module_name_idx ON public.system_activity_logs USING btree (module_name);


--
-- Name: system_activity_logs_request_no_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_activity_logs_request_no_idx ON public.system_activity_logs USING btree (request_no);


--
-- Name: talent_candidate_certifications_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_certifications_candidate_idx ON public.talent_candidate_certifications USING btree (candidate_id, issue_date DESC);


--
-- Name: talent_candidate_consent_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX talent_candidate_consent_unique ON public.talent_candidate_consents USING btree (candidate_id, consent_type, consent_version);


--
-- Name: talent_candidate_documents_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_documents_candidate_idx ON public.talent_candidate_documents USING btree (candidate_id, uploaded_at DESC);


--
-- Name: talent_candidate_education_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_education_candidate_idx ON public.talent_candidate_education USING btree (candidate_id, sort_order, graduation_date DESC);


--
-- Name: talent_candidate_events_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_events_candidate_idx ON public.talent_candidate_events USING btree (candidate_id, created_at DESC);


--
-- Name: talent_candidate_events_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_events_name_idx ON public.talent_candidate_events USING btree (event_name, created_at DESC);


--
-- Name: talent_candidate_experience_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_experience_candidate_idx ON public.talent_candidate_experience USING btree (candidate_id, sort_order, start_date DESC);


--
-- Name: talent_candidate_primary_cv_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX talent_candidate_primary_cv_unique ON public.talent_candidate_documents USING btree (candidate_id) WHERE ((document_type = 'CV'::text) AND (is_primary = true));


--
-- Name: talent_candidate_skills_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_skills_candidate_idx ON public.talent_candidate_skills USING btree (candidate_id);


--
-- Name: talent_candidate_skills_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidate_skills_name_idx ON public.talent_candidate_skills USING btree (lower(skill_name));


--
-- Name: talent_candidates_auth_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidates_auth_user_idx ON public.talent_candidates USING btree (auth_user_id);


--
-- Name: talent_candidates_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidates_created_at_idx ON public.talent_candidates USING btree (created_at DESC);


--
-- Name: talent_candidates_marketplace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidates_marketplace_idx ON public.talent_candidates USING btree (marketplace_status, profile_visibility, employer_sharing_consent);


--
-- Name: talent_candidates_nationality_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidates_nationality_idx ON public.talent_candidates USING btree (nationality);


--
-- Name: talent_candidates_profession_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_candidates_profession_idx ON public.talent_candidates USING btree (profession);


--
-- Name: talent_cv_analysis_runs_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_cv_analysis_runs_candidate_idx ON public.talent_cv_analysis_runs USING btree (candidate_id, created_at DESC);


--
-- Name: talent_cv_analysis_runs_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_cv_analysis_runs_document_idx ON public.talent_cv_analysis_runs USING btree (document_id, created_at DESC);


--
-- Name: talent_resume_versions_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX talent_resume_versions_candidate_idx ON public.talent_resume_versions USING btree (candidate_id, version_number DESC);


--
-- Name: uq_agency_agreements_company_agreement_no; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_agency_agreements_company_agreement_no ON public.agency_agreements USING btree (company_id, agreement_no) WHERE ((agreement_no IS NOT NULL) AND (agreement_no <> ''::text));


--
-- Name: uq_agency_penalties_candidate_agreement; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_agency_penalties_candidate_agreement ON public.agency_penalties USING btree (company_id, candidate_id, agreement_no);


--
-- Name: users_auth_user_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_auth_user_id_unique ON public.users USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);


--
-- Name: users_auth_user_id_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_auth_user_id_unique_idx ON public.users USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);


--
-- Name: users_email_unique_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_unique_lower_idx ON public.users USING btree (lower(TRIM(BOTH FROM email)));


--
-- Name: ux_ai_interview_analysis_jobs_one_active_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_ai_interview_analysis_jobs_one_active_session ON public.ai_interview_analysis_jobs USING btree (session_id) WHERE (status = ANY (ARRAY['Queued'::text, 'Processing'::text]));


--
-- Name: ux_candidate_technical_profiles_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_candidate_technical_profiles_candidate ON public.candidate_technical_profiles USING btree (candidate_id);


--
-- Name: ux_education_institutions_scope_name_country; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_education_institutions_scope_name_country ON public.education_institutions USING btree (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(TRIM(BOTH FROM institution_name)), lower(TRIM(BOTH FROM country)));


--
-- Name: ux_profession_aliases_company_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_profession_aliases_company_normalized ON public.profession_aliases USING btree (company_id, normalized_alias) WHERE (company_id IS NOT NULL);


--
-- Name: ux_profession_aliases_global_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_profession_aliases_global_normalized ON public.profession_aliases USING btree (normalized_alias) WHERE (company_id IS NULL);


--
-- Name: ai_interview_campaigns ai_interview_campaign_apply_delivery_settings_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_interview_campaign_apply_delivery_settings_trigger BEFORE INSERT OR UPDATE OF settings, interaction_mode, interview_mode, camera_mode, max_dynamic_follow_ups, live_response_timeout_seconds ON public.ai_interview_campaigns FOR EACH ROW EXECUTE FUNCTION public.ai_interview_campaign_apply_delivery_settings();


--
-- Name: talent_candidate_certifications talent_candidate_certifications_managed_fields_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_certifications_managed_fields_guard_trigger BEFORE INSERT OR UPDATE ON public.talent_candidate_certifications FOR EACH ROW EXECUTE FUNCTION public.talent_guard_managed_fields();


--
-- Name: talent_candidate_certifications talent_candidate_certifications_profile_refresh_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_certifications_profile_refresh_trigger AFTER INSERT OR DELETE OR UPDATE ON public.talent_candidate_certifications FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: talent_candidate_certifications talent_candidate_certifications_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_certifications_updated_at_trigger BEFORE UPDATE ON public.talent_candidate_certifications FOR EACH ROW EXECUTE FUNCTION public.talent_set_updated_at();


--
-- Name: talent_candidate_consents talent_candidate_consents_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_consents_updated_at_trigger BEFORE UPDATE ON public.talent_candidate_consents FOR EACH ROW EXECUTE FUNCTION public.talent_set_updated_at();


--
-- Name: talent_candidate_documents talent_candidate_documents_managed_fields_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_documents_managed_fields_guard_trigger BEFORE INSERT OR UPDATE ON public.talent_candidate_documents FOR EACH ROW EXECUTE FUNCTION public.talent_guard_managed_fields();


--
-- Name: talent_candidate_documents talent_candidate_documents_profile_refresh_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_documents_profile_refresh_trigger AFTER INSERT OR DELETE OR UPDATE ON public.talent_candidate_documents FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: talent_candidate_documents talent_candidate_documents_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_documents_updated_at_trigger BEFORE UPDATE ON public.talent_candidate_documents FOR EACH ROW EXECUTE FUNCTION public.talent_set_updated_at();


--
-- Name: talent_candidate_education talent_candidate_education_managed_fields_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_education_managed_fields_guard_trigger BEFORE INSERT OR UPDATE ON public.talent_candidate_education FOR EACH ROW EXECUTE FUNCTION public.talent_guard_managed_fields();


--
-- Name: talent_candidate_education talent_candidate_education_profile_refresh_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_education_profile_refresh_trigger AFTER INSERT OR DELETE OR UPDATE ON public.talent_candidate_education FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: talent_candidate_education talent_candidate_education_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_education_updated_at_trigger BEFORE UPDATE ON public.talent_candidate_education FOR EACH ROW EXECUTE FUNCTION public.talent_set_updated_at();


--
-- Name: talent_candidate_experience talent_candidate_experience_managed_fields_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_experience_managed_fields_guard_trigger BEFORE INSERT OR UPDATE ON public.talent_candidate_experience FOR EACH ROW EXECUTE FUNCTION public.talent_guard_managed_fields();


--
-- Name: talent_candidate_experience talent_candidate_experience_profile_refresh_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_experience_profile_refresh_trigger AFTER INSERT OR DELETE OR UPDATE ON public.talent_candidate_experience FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: talent_candidate_experience talent_candidate_experience_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_experience_updated_at_trigger BEFORE UPDATE ON public.talent_candidate_experience FOR EACH ROW EXECUTE FUNCTION public.talent_set_updated_at();


--
-- Name: talent_candidate_skills talent_candidate_skills_managed_fields_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_skills_managed_fields_guard_trigger BEFORE INSERT OR UPDATE ON public.talent_candidate_skills FOR EACH ROW EXECUTE FUNCTION public.talent_guard_managed_fields();


--
-- Name: talent_candidate_skills talent_candidate_skills_profile_refresh_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_skills_profile_refresh_trigger AFTER INSERT OR DELETE OR UPDATE ON public.talent_candidate_skills FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: talent_candidate_skills talent_candidate_skills_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidate_skills_updated_at_trigger BEFORE UPDATE ON public.talent_candidate_skills FOR EACH ROW EXECUTE FUNCTION public.talent_set_updated_at();


--
-- Name: talent_candidates talent_candidates_completion_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidates_completion_refresh AFTER INSERT OR UPDATE OF full_name, email, phone, nationality, country_of_residence, city, profession, current_job_title, years_experience, expected_salary, languages, headline, professional_summary, marketplace_status ON public.talent_candidates FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: talent_candidates talent_candidates_managed_fields_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidates_managed_fields_guard_trigger BEFORE INSERT OR UPDATE ON public.talent_candidates FOR EACH ROW EXECUTE FUNCTION public.talent_guard_managed_fields();


--
-- Name: talent_candidates talent_candidates_profile_refresh_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidates_profile_refresh_after_insert AFTER INSERT ON public.talent_candidates FOR EACH ROW EXECUTE FUNCTION public.talent_after_candidate_profile_change();


--
-- Name: talent_candidates talent_candidates_profile_refresh_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidates_profile_refresh_after_update AFTER UPDATE OF full_name, email, phone, profession, nationality, country_of_residence, years_experience, professional_summary, languages ON public.talent_candidates FOR EACH ROW EXECUTE FUNCTION public.talent_after_candidate_profile_change();


--
-- Name: talent_candidates talent_candidates_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_candidates_updated_at_trigger BEFORE UPDATE ON public.talent_candidates FOR EACH ROW EXECUTE FUNCTION public.talent_set_updated_at();


--
-- Name: talent_candidate_consents talent_consents_completion_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_consents_completion_refresh AFTER INSERT OR DELETE OR UPDATE ON public.talent_candidate_consents FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: talent_candidate_documents talent_documents_completion_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER talent_documents_completion_refresh AFTER INSERT OR DELETE OR UPDATE ON public.talent_candidate_documents FOR EACH ROW EXECUTE FUNCTION public.talent_after_profile_change();


--
-- Name: agency_agreements trg_activity_agency_agreements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_agency_agreements AFTER INSERT OR DELETE OR UPDATE ON public.agency_agreements FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Agency Agreements');


--
-- Name: agency_penalties trg_activity_agency_penalties; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_agency_penalties AFTER INSERT OR DELETE OR UPDATE ON public.agency_penalties FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Penalty Register');


--
-- Name: candidates trg_activity_candidates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_candidates AFTER INSERT OR DELETE OR UPDATE ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Candidates');


--
-- Name: collections trg_activity_collections; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_collections AFTER INSERT OR DELETE OR UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Collections');


--
-- Name: demobilizations trg_activity_demobilizations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_demobilizations AFTER INSERT OR DELETE OR UPDATE ON public.demobilizations FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Demobilization');


--
-- Name: employees trg_activity_employees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_employees AFTER INSERT OR DELETE OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Employees');


--
-- Name: interviews trg_activity_interviews; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_interviews AFTER INSERT OR DELETE OR UPDATE ON public.interviews FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Interviews');


--
-- Name: invoices trg_activity_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Invoices');


--
-- Name: marketplace_deals trg_activity_marketplace_deals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_marketplace_deals AFTER INSERT OR DELETE OR UPDATE ON public.marketplace_deals FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Workforce Marketplace Deals');


--
-- Name: marketplace_requests trg_activity_marketplace_requests; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_marketplace_requests AFTER INSERT OR DELETE OR UPDATE ON public.marketplace_requests FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Workforce Marketplace Requests');


--
-- Name: mobilizations trg_activity_mobilizations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_mobilizations AFTER INSERT OR DELETE OR UPDATE ON public.mobilizations FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Mobilization');


--
-- Name: request_lines trg_activity_request_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_request_lines AFTER INSERT OR DELETE OR UPDATE ON public.request_lines FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Request Lines');


--
-- Name: requests trg_activity_requests; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_requests AFTER INSERT OR DELETE OR UPDATE ON public.requests FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Requests');


--
-- Name: visa_allocations trg_activity_visa_allocations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_visa_allocations AFTER INSERT OR DELETE OR UPDATE ON public.visa_allocations FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Visa Allocation');


--
-- Name: visa_authorizations trg_activity_visa_authorizations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_visa_authorizations AFTER INSERT OR DELETE OR UPDATE ON public.visa_authorizations FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Authorizations');


--
-- Name: visa_batch_lines trg_activity_visa_batch_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_visa_batch_lines AFTER INSERT OR DELETE OR UPDATE ON public.visa_batch_lines FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Visa Lines');


--
-- Name: visa_batches trg_activity_visa_batches; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activity_visa_batches AFTER INSERT OR DELETE OR UPDATE ON public.visa_batches FOR EACH ROW EXECUTE FUNCTION public.log_system_activity('Visa Inventory');


--
-- Name: agency_agreements trg_agency_agreements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agency_agreements_updated_at BEFORE UPDATE ON public.agency_agreements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_interview_answers trg_ai_answers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_answers_updated_at BEFORE UPDATE ON public.ai_interview_answers FOR EACH ROW EXECUTE FUNCTION public.set_ai_interview_updated_at();


--
-- Name: ai_interview_campaign_candidates trg_ai_interview_campaign_candidate_sync_session_delivery; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_interview_campaign_candidate_sync_session_delivery AFTER INSERT OR UPDATE OF session_id, campaign_id ON public.ai_interview_campaign_candidates FOR EACH ROW EXECUTE FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger();


--
-- Name: ai_interview_campaign_candidates trg_ai_interview_campaign_candidates_refresh_counts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_interview_campaign_candidates_refresh_counts AFTER INSERT OR DELETE OR UPDATE ON public.ai_interview_campaign_candidates FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_ai_interview_campaign_counts();


--
-- Name: ai_interview_campaign_candidates trg_ai_interview_campaign_candidates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_interview_campaign_candidates_updated_at BEFORE UPDATE ON public.ai_interview_campaign_candidates FOR EACH ROW EXECUTE FUNCTION public.set_ai_interview_campaign_updated_at();


--
-- Name: ai_interview_campaigns trg_ai_interview_campaign_sync_delivery_to_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_interview_campaign_sync_delivery_to_sessions AFTER UPDATE OF interaction_mode, interview_mode, camera_mode, max_dynamic_follow_ups, live_response_timeout_seconds ON public.ai_interview_campaigns FOR EACH ROW EXECUTE FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger();


--
-- Name: ai_interview_campaigns trg_ai_interview_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_interview_campaigns_updated_at BEFORE UPDATE ON public.ai_interview_campaigns FOR EACH ROW EXECUTE FUNCTION public.set_ai_interview_campaign_updated_at();


--
-- Name: ai_interview_invitation_jobs trg_ai_interview_invitation_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_interview_invitation_jobs_updated_at BEFORE UPDATE ON public.ai_interview_invitation_jobs FOR EACH ROW EXECUTE FUNCTION public.set_ai_interview_campaign_updated_at();


--
-- Name: ai_interview_sessions trg_ai_interview_sessions_enforce_campaign_delivery; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_interview_sessions_enforce_campaign_delivery BEFORE INSERT OR UPDATE OF campaign_id, interaction_mode, interview_mode, camera_mode, max_dynamic_follow_ups, live_response_timeout_seconds ON public.ai_interview_sessions FOR EACH ROW EXECUTE FUNCTION public.ai_interview_enforce_campaign_delivery_on_session();


--
-- Name: ai_interview_questions trg_ai_questions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_questions_updated_at BEFORE UPDATE ON public.ai_interview_questions FOR EACH ROW EXECUTE FUNCTION public.set_ai_interview_updated_at();


--
-- Name: ai_interview_sessions trg_ai_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_sessions_updated_at BEFORE UPDATE ON public.ai_interview_sessions FOR EACH ROW EXECUTE FUNCTION public.set_ai_interview_updated_at();


--
-- Name: ai_interview_templates trg_ai_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_templates_updated_at BEFORE UPDATE ON public.ai_interview_templates FOR EACH ROW EXECUTE FUNCTION public.set_ai_interview_updated_at();


--
-- Name: requests trg_assign_request_no_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_request_no_before_insert BEFORE INSERT ON public.requests FOR EACH ROW EXECUTE FUNCTION public.assign_request_no_before_insert();


--
-- Name: candidates trg_create_onboarding_validation_from_candidate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_create_onboarding_validation_from_candidate AFTER INSERT OR UPDATE OF status, arrival_date, joining_date ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.create_onboarding_validation_from_candidate();


--
-- Name: ai_interview_sessions trg_enqueue_ai_interview_analysis_on_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enqueue_ai_interview_analysis_on_completion AFTER UPDATE OF status ON public.ai_interview_sessions FOR EACH ROW WHEN (((new.status = 'Completed'::text) AND (old.status IS DISTINCT FROM 'Completed'::text))) EXECUTE FUNCTION public.enqueue_ai_interview_analysis_on_completion();


--
-- Name: requests trg_generate_request_no; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_generate_request_no BEFORE INSERT ON public.requests FOR EACH ROW EXECUTE FUNCTION public.generate_request_no();


--
-- Name: agency_company_user_access trg_guard_agency_company_user_access; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_agency_company_user_access BEFORE INSERT OR UPDATE ON public.agency_company_user_access FOR EACH ROW EXECUTE FUNCTION public.guard_agency_company_user_access();


--
-- Name: company_agency_access trg_guard_company_agency_access; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_company_agency_access BEFORE INSERT OR UPDATE ON public.company_agency_access FOR EACH ROW EXECUTE FUNCTION public.guard_company_agency_access();


--
-- Name: users trg_guard_platform_user_roles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_platform_user_roles BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_platform_user_roles();


--
-- Name: users trg_guard_users_security; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_users_security BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_users_security();


--
-- Name: onboarding_validations trg_onboarding_validations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_onboarding_validations_updated_at BEFORE UPDATE ON public.onboarding_validations FOR EACH ROW EXECUTE FUNCTION public.set_onboarding_validations_updated_at();


--
-- Name: ai_interview_sessions trg_sync_ai_interview_session_to_campaign; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_ai_interview_session_to_campaign AFTER INSERT OR UPDATE OF status, invitation_sent_at, first_opened_at, started_at, completed_at, analysis_status, analysis_completed_at, analysis_error, overall_score, ai_recommendation, human_decision, updated_at ON public.ai_interview_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_ai_interview_session_to_campaign();


--
-- Name: agencies agencies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: agency_company_user_access agency_company_user_access_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_company_user_access
    ADD CONSTRAINT agency_company_user_access_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- Name: agency_company_user_access agency_company_user_access_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_company_user_access
    ADD CONSTRAINT agency_company_user_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: agency_company_user_access agency_company_user_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_company_user_access
    ADD CONSTRAINT agency_company_user_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_interview_analysis_jobs ai_interview_analysis_jobs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_analysis_jobs
    ADD CONSTRAINT ai_interview_analysis_jobs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_interview_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_interview_answers ai_interview_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_answers
    ADD CONSTRAINT ai_interview_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.ai_interview_questions(id) ON DELETE SET NULL;


--
-- Name: ai_interview_answers ai_interview_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_answers
    ADD CONSTRAINT ai_interview_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_interview_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_interview_campaign_candidates ai_interview_campaign_candidates_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaign_candidates
    ADD CONSTRAINT ai_interview_campaign_candidates_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ai_interview_campaigns(id) ON DELETE CASCADE;


--
-- Name: ai_interview_campaign_candidates ai_interview_campaign_candidates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaign_candidates
    ADD CONSTRAINT ai_interview_campaign_candidates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ai_interview_campaign_candidates ai_interview_campaign_candidates_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaign_candidates
    ADD CONSTRAINT ai_interview_campaign_candidates_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_interview_sessions(id) ON DELETE SET NULL;


--
-- Name: ai_interview_campaigns ai_interview_campaigns_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaigns
    ADD CONSTRAINT ai_interview_campaigns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ai_interview_campaigns ai_interview_campaigns_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaigns
    ADD CONSTRAINT ai_interview_campaigns_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_interview_campaigns ai_interview_campaigns_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_campaigns
    ADD CONSTRAINT ai_interview_campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.ai_interview_templates(id) ON DELETE RESTRICT;


--
-- Name: ai_interview_conversation_turns ai_interview_conversation_turns_answer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_conversation_turns
    ADD CONSTRAINT ai_interview_conversation_turns_answer_id_fkey FOREIGN KEY (answer_id) REFERENCES public.ai_interview_answers(id) ON DELETE SET NULL;


--
-- Name: ai_interview_conversation_turns ai_interview_conversation_turns_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_conversation_turns
    ADD CONSTRAINT ai_interview_conversation_turns_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_interview_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_interview_generation_runs ai_interview_generation_runs_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_generation_runs
    ADD CONSTRAINT ai_interview_generation_runs_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.ai_interview_templates(id) ON DELETE SET NULL;


--
-- Name: ai_interview_invitation_jobs ai_interview_invitation_jobs_campaign_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_invitation_jobs
    ADD CONSTRAINT ai_interview_invitation_jobs_campaign_candidate_id_fkey FOREIGN KEY (campaign_candidate_id) REFERENCES public.ai_interview_campaign_candidates(id) ON DELETE CASCADE;


--
-- Name: ai_interview_invitation_jobs ai_interview_invitation_jobs_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_invitation_jobs
    ADD CONSTRAINT ai_interview_invitation_jobs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ai_interview_campaigns(id) ON DELETE CASCADE;


--
-- Name: ai_interview_invitation_jobs ai_interview_invitation_jobs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_invitation_jobs
    ADD CONSTRAINT ai_interview_invitation_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ai_interview_invitation_jobs ai_interview_invitation_jobs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_invitation_jobs
    ADD CONSTRAINT ai_interview_invitation_jobs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_interview_sessions(id) ON DELETE SET NULL;


--
-- Name: ai_interview_questions ai_interview_questions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_questions
    ADD CONSTRAINT ai_interview_questions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.ai_interview_templates(id) ON DELETE CASCADE;


--
-- Name: ai_interview_session_events ai_interview_session_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_session_events
    ADD CONSTRAINT ai_interview_session_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_interview_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_interview_sessions ai_interview_sessions_campaign_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_campaign_candidate_id_fkey FOREIGN KEY (campaign_candidate_id) REFERENCES public.ai_interview_campaign_candidates(id) ON DELETE SET NULL;


--
-- Name: ai_interview_sessions ai_interview_sessions_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ai_interview_campaigns(id) ON DELETE SET NULL;


--
-- Name: ai_interview_sessions ai_interview_sessions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_sessions
    ADD CONSTRAINT ai_interview_sessions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.ai_interview_templates(id) ON DELETE RESTRICT;


--
-- Name: ai_interview_templates ai_interview_templates_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interview_templates
    ADD CONSTRAINT ai_interview_templates_supersedes_fk FOREIGN KEY (supersedes_template_id) REFERENCES public.ai_interview_templates(id) ON DELETE SET NULL;


--
-- Name: candidate_technical_profiles candidate_technical_profiles_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_technical_profiles
    ADD CONSTRAINT candidate_technical_profiles_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE CASCADE;


--
-- Name: candidate_technical_profiles candidate_technical_profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_technical_profiles
    ADD CONSTRAINT candidate_technical_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: candidate_technical_profiles candidate_technical_profiles_institution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_technical_profiles
    ADD CONSTRAINT candidate_technical_profiles_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES public.education_institutions(id) ON DELETE SET NULL;


--
-- Name: candidates candidates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: education_institutions education_institutions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.education_institutions
    ADD CONSTRAINT education_institutions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: agency_score_history fk_agency_score_history_agency; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_score_history
    ADD CONSTRAINT fk_agency_score_history_agency FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE CASCADE;


--
-- Name: agency_score_history fk_agency_score_history_company; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_score_history
    ADD CONSTRAINT fk_agency_score_history_company FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: interviews interviews_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: mobilizations mobilizations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobilizations
    ADD CONSTRAINT mobilizations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: profession_aliases profession_aliases_profession_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profession_aliases
    ADD CONSTRAINT profession_aliases_profession_id_fkey FOREIGN KEY (profession_id) REFERENCES public.professions(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: request_audit_logs request_audit_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_audit_logs
    ADD CONSTRAINT request_audit_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: requests requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: subscription_invoices subscription_invoices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.platform_clients(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: system_restore_requests system_restore_requests_backup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_restore_requests
    ADD CONSTRAINT system_restore_requests_backup_id_fkey FOREIGN KEY (backup_id) REFERENCES public.system_backups(id) ON DELETE RESTRICT;


--
-- Name: talent_candidate_certifications talent_candidate_certifications_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_certifications
    ADD CONSTRAINT talent_candidate_certifications_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_candidate_consents talent_candidate_consents_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_consents
    ADD CONSTRAINT talent_candidate_consents_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_candidate_documents talent_candidate_documents_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_documents
    ADD CONSTRAINT talent_candidate_documents_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_candidate_education talent_candidate_education_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_education
    ADD CONSTRAINT talent_candidate_education_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_candidate_events talent_candidate_events_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_events
    ADD CONSTRAINT talent_candidate_events_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: talent_candidate_events talent_candidate_events_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_events
    ADD CONSTRAINT talent_candidate_events_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_candidate_experience talent_candidate_experience_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_experience
    ADD CONSTRAINT talent_candidate_experience_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_candidate_skills talent_candidate_skills_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidate_skills
    ADD CONSTRAINT talent_candidate_skills_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_candidates talent_candidates_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_candidates
    ADD CONSTRAINT talent_candidates_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: talent_cv_analysis_runs talent_cv_analysis_runs_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_cv_analysis_runs
    ADD CONSTRAINT talent_cv_analysis_runs_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_cv_analysis_runs talent_cv_analysis_runs_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_cv_analysis_runs
    ADD CONSTRAINT talent_cv_analysis_runs_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.talent_candidate_documents(id) ON DELETE CASCADE;


--
-- Name: talent_resume_versions talent_resume_versions_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_resume_versions
    ADD CONSTRAINT talent_resume_versions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.talent_candidates(id) ON DELETE CASCADE;


--
-- Name: talent_resume_versions talent_resume_versions_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.talent_resume_versions
    ADD CONSTRAINT talent_resume_versions_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.talent_candidate_documents(id) ON DELETE SET NULL;


--
-- Name: users users_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: users users_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: visa_allocations visa_allocations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_allocations
    ADD CONSTRAINT visa_allocations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: visa_authorizations visa_authorizations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_authorizations
    ADD CONSTRAINT visa_authorizations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: visa_batches visa_batches_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_batches
    ADD CONSTRAINT visa_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: countries Allow read countries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read countries" ON public.countries FOR SELECT USING (true);


--
-- Name: professions Allow read professions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read professions" ON public.professions FOR SELECT USING (true);


--
-- Name: agencies Allow select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow select" ON public.agencies FOR SELECT USING (true);


--
-- Name: agencies Enable insert for authenticated users only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable insert for authenticated users only" ON public.agencies FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: agencies Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.agencies FOR SELECT USING (true);


--
-- Name: agencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

--
-- Name: agencies agencies company access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "agencies company access" ON public.agencies USING ((company_id = ( SELECT profiles.company_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((company_id = ( SELECT profiles.company_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: agencies agencies_delete_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agencies_delete_public ON public.agencies FOR DELETE USING (true);


--
-- Name: agencies agencies_insert_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agencies_insert_public ON public.agencies FOR INSERT WITH CHECK (true);


--
-- Name: agencies agencies_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agencies_select_public ON public.agencies FOR SELECT USING (true);


--
-- Name: agencies agencies_update_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agencies_update_public ON public.agencies FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: agency_score_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agency_score_history ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_agent_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_agent_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interview_analysis_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_interview_analysis_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interview_campaign_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_interview_campaign_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interview_campaign_candidates ai_interview_campaign_candidates_tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_interview_campaign_candidates_tenant_all ON public.ai_interview_campaign_candidates TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = auth.uid()) AND (lower(COALESCE(u.status, 'Active'::text)) = 'active'::text) AND ((u.company_id = ai_interview_campaign_candidates.company_id) OR (lower(COALESCE(u.role, ''::text)) = 'platform owner'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = auth.uid()) AND (lower(COALESCE(u.status, 'Active'::text)) = 'active'::text) AND ((u.company_id = ai_interview_campaign_candidates.company_id) OR (lower(COALESCE(u.role, ''::text)) = 'platform owner'::text))))));


--
-- Name: ai_interview_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_interview_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interview_campaigns ai_interview_campaigns_tenant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_interview_campaigns_tenant_all ON public.ai_interview_campaigns TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = auth.uid()) AND (lower(COALESCE(u.status, 'Active'::text)) = 'active'::text) AND ((u.company_id = ai_interview_campaigns.company_id) OR (lower(COALESCE(u.role, ''::text)) = 'platform owner'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = auth.uid()) AND (lower(COALESCE(u.status, 'Active'::text)) = 'active'::text) AND ((u.company_id = ai_interview_campaigns.company_id) OR (lower(COALESCE(u.role, ''::text)) = 'platform owner'::text))))));


--
-- Name: ai_interview_conversation_turns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_interview_conversation_turns ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interview_invitation_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_interview_invitation_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interview_invitation_jobs ai_interview_invitation_jobs_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_interview_invitation_jobs_tenant_select ON public.ai_interview_invitation_jobs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = auth.uid()) AND (lower(COALESCE(u.status, 'Active'::text)) = 'active'::text) AND ((u.company_id = ai_interview_invitation_jobs.company_id) OR (lower(COALESCE(u.role, ''::text)) = 'platform owner'::text))))));


--
-- Name: ai_interview_session_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_interview_session_events ENABLE ROW LEVEL SECURITY;

--
-- Name: candidates candidates_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidates_delete_tenant_policy ON public.candidates FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Recruitment Manager'::text]))));


--
-- Name: candidates candidates_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidates_insert_tenant_policy ON public.candidates FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Project Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text, 'HR/Recruitment'::text]))));


--
-- Name: candidates candidates_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidates_select_tenant_policy ON public.candidates FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: candidates candidates_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY candidates_update_tenant_policy ON public.candidates FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Project Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text, 'HR/Recruitment'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: companies companies select own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "companies select own" ON public.companies FOR SELECT USING ((id = ( SELECT profiles.company_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: countries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

--
-- Name: email_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: employees employees_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_delete_tenant_policy ON public.employees FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text]))));


--
-- Name: employees employees_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_insert_tenant_policy ON public.employees FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'HR/Recruitment'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text]))));


--
-- Name: employees employees_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_select_tenant_policy ON public.employees FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: employees employees_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_update_tenant_policy ON public.employees FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'HR/Recruitment'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: interviews interviews_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interviews_delete_tenant_policy ON public.interviews FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Recruitment Manager'::text]))));


--
-- Name: interviews interviews_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interviews_insert_tenant_policy ON public.interviews FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text, 'HR/Recruitment'::text]))));


--
-- Name: interviews interviews_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interviews_select_tenant_policy ON public.interviews FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: interviews interviews_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interviews_update_tenant_policy ON public.interviews FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text, 'HR/Recruitment'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: mobilizations mobilizations_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobilizations_delete_tenant_policy ON public.mobilizations FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text]))));


--
-- Name: mobilizations mobilizations_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobilizations_insert_tenant_policy ON public.mobilizations FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text, 'HR/Recruitment'::text]))));


--
-- Name: mobilizations mobilizations_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobilizations_select_tenant_policy ON public.mobilizations FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: mobilizations mobilizations_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobilizations_update_tenant_policy ON public.mobilizations FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text, 'HR/Recruitment'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: notification_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

--
-- Name: professions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professions ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles select own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles select own" ON public.profiles FOR SELECT USING ((id = auth.uid()));


--
-- Name: request_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.request_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: request_lines request_lines_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY request_lines_delete_tenant_policy ON public.request_lines FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text]))));


--
-- Name: request_lines request_lines_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY request_lines_insert_tenant_policy ON public.request_lines FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Project Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text]))));


--
-- Name: request_lines request_lines_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY request_lines_select_tenant_policy ON public.request_lines FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: request_lines request_lines_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY request_lines_update_tenant_policy ON public.request_lines FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Project Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: requests requests_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requests_delete_tenant_policy ON public.requests FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text]))));


--
-- Name: requests requests_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requests_insert_tenant_policy ON public.requests FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Project Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text]))));


--
-- Name: requests requests_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requests_select_tenant_policy ON public.requests FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: requests requests_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requests_update_tenant_policy ON public.requests FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Project Manager'::text, 'Recruitment Manager'::text, 'Recruitment Officer'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: agency_score_history secure_agency_score_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: agency_score_history secure_agency_score_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: ai_agent_audit_logs secure_ai_agent_audit_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: ai_agent_audit_logs secure_ai_agent_audit_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: email_logs secure_email_log_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: email_logs secure_email_log_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: notification_events secure_notification_delete; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: notification_events secure_notification_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: notification_events secure_notification_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: notification_events secure_notification_update; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: request_audit_logs secure_request_audit_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: request_audit_logs secure_request_audit_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: system_restore_requests secure_restore_request_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: system_restore_requests secure_restore_request_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: system_restore_requests secure_restore_request_update; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: support_tickets secure_support_ticket_delete; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: support_tickets secure_support_ticket_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: support_tickets secure_support_ticket_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: support_tickets secure_support_ticket_update; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: system_activity_logs secure_system_activity_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: system_backups secure_system_backup_delete; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: system_backups secure_system_backup_insert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: system_backups secure_system_backup_select; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: talent_candidate_events secure_talent_event_insert_own; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: talent_candidate_events secure_talent_event_select_own; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: system_activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: system_backups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_backups ENABLE ROW LEVEL SECURITY;

--
-- Name: system_restore_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_restore_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_certifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_certifications ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_certifications talent_candidate_certifications_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_certifications_delete_own ON public.talent_candidate_certifications FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_certifications.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_certifications talent_candidate_certifications_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_certifications_insert_own ON public.talent_candidate_certifications FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_certifications.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_certifications talent_candidate_certifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_certifications_select_own ON public.talent_candidate_certifications FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_certifications.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_certifications talent_candidate_certifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_certifications_update_own ON public.talent_candidate_certifications FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_certifications.candidate_id) AND (c.auth_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_certifications.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_consents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_consents talent_candidate_consents_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_consents_delete_own ON public.talent_candidate_consents FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_consents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_consents talent_candidate_consents_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_consents_insert_own ON public.talent_candidate_consents FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_consents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_consents talent_candidate_consents_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_consents_select_own ON public.talent_candidate_consents FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_consents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_consents talent_candidate_consents_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_consents_update_own ON public.talent_candidate_consents FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_consents.candidate_id) AND (c.auth_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_consents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_documents talent_candidate_documents_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_documents_delete_own ON public.talent_candidate_documents FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_documents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_documents talent_candidate_documents_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_documents_insert_own ON public.talent_candidate_documents FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_documents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_documents talent_candidate_documents_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_documents_select_own ON public.talent_candidate_documents FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_documents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_documents talent_candidate_documents_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_documents_update_own ON public.talent_candidate_documents FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_documents.candidate_id) AND (c.auth_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_documents.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_education; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_education ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_education talent_candidate_education_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_education_delete_own ON public.talent_candidate_education FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_education.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_education talent_candidate_education_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_education_insert_own ON public.talent_candidate_education FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_education.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_education talent_candidate_education_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_education_select_own ON public.talent_candidate_education FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_education.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_education talent_candidate_education_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_education_update_own ON public.talent_candidate_education FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_education.candidate_id) AND (c.auth_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_education.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_events ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_experience; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_experience ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_experience talent_candidate_experience_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_experience_delete_own ON public.talent_candidate_experience FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_experience.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_experience talent_candidate_experience_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_experience_insert_own ON public.talent_candidate_experience FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_experience.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_experience talent_candidate_experience_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_experience_select_own ON public.talent_candidate_experience FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_experience.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_experience talent_candidate_experience_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_experience_update_own ON public.talent_candidate_experience FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_experience.candidate_id) AND (c.auth_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_experience.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidate_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidate_skills talent_candidate_skills_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_skills_delete_own ON public.talent_candidate_skills FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_skills.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_skills talent_candidate_skills_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_skills_insert_own ON public.talent_candidate_skills FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_skills.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_skills talent_candidate_skills_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_skills_select_own ON public.talent_candidate_skills FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_skills.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidate_skills talent_candidate_skills_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidate_skills_update_own ON public.talent_candidate_skills FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_skills.candidate_id) AND (c.auth_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_candidate_skills.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_candidates talent_candidates_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidates_insert_own ON public.talent_candidates FOR INSERT TO authenticated WITH CHECK (((auth_user_id = auth.uid()) AND (marketplace_status = 'Draft'::text) AND (is_verified = false) AND (latest_ai_interview_session_id IS NULL) AND (latest_ai_interview_score IS NULL) AND (latest_ai_recommendation IS NULL)));


--
-- Name: talent_candidates talent_candidates_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidates_select_own ON public.talent_candidates FOR SELECT TO authenticated USING ((auth_user_id = auth.uid()));


--
-- Name: talent_candidates talent_candidates_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_candidates_update_own ON public.talent_candidates FOR UPDATE TO authenticated USING ((auth_user_id = auth.uid())) WITH CHECK ((auth_user_id = auth.uid()));


--
-- Name: talent_cv_analysis_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_cv_analysis_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_cv_analysis_runs talent_cv_analysis_runs_candidate_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_cv_analysis_runs_candidate_select ON public.talent_cv_analysis_runs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_cv_analysis_runs.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_resume_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.talent_resume_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: talent_resume_versions talent_resume_versions_candidate_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_resume_versions_candidate_select ON public.talent_resume_versions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_resume_versions.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: talent_resume_versions talent_resume_versions_candidate_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY talent_resume_versions_candidate_update ON public.talent_resume_versions FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_resume_versions.candidate_id) AND (c.auth_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.talent_candidates c
  WHERE ((c.id = talent_resume_versions.candidate_id) AND (c.auth_user_id = auth.uid())))));


--
-- Name: visa_allocations visa_allocations_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_allocations_delete_tenant_policy ON public.visa_allocations FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text]))));


--
-- Name: visa_allocations visa_allocations_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_allocations_insert_tenant_policy ON public.visa_allocations FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text]))));


--
-- Name: visa_allocations visa_allocations_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_allocations_select_tenant_policy ON public.visa_allocations FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: visa_allocations visa_allocations_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_allocations_update_tenant_policy ON public.visa_allocations FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: visa_authorizations visa_authorizations_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_authorizations_delete_tenant_policy ON public.visa_authorizations FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text]))));


--
-- Name: visa_authorizations visa_authorizations_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_authorizations_insert_tenant_policy ON public.visa_authorizations FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text]))));


--
-- Name: visa_authorizations visa_authorizations_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_authorizations_select_tenant_policy ON public.visa_authorizations FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: visa_authorizations visa_authorizations_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_authorizations_update_tenant_policy ON public.visa_authorizations FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: visa_batch_lines visa_batch_lines_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batch_lines_delete_tenant_policy ON public.visa_batch_lines FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text]))));


--
-- Name: visa_batch_lines visa_batch_lines_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batch_lines_insert_tenant_policy ON public.visa_batch_lines FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text]))));


--
-- Name: visa_batch_lines visa_batch_lines_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batch_lines_select_tenant_policy ON public.visa_batch_lines FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: visa_batch_lines visa_batch_lines_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batch_lines_update_tenant_policy ON public.visa_batch_lines FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: visa_batches visa_batches_delete_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batches_delete_tenant_policy ON public.visa_batches FOR DELETE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text]))));


--
-- Name: visa_batches visa_batches_insert_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batches_insert_tenant_policy ON public.visa_batches FOR INSERT TO authenticated WITH CHECK ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text]))));


--
-- Name: visa_batches visa_batches_select_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batches_select_tenant_policy ON public.visa_batches FOR SELECT TO authenticated USING ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));


--
-- Name: visa_batches visa_batches_update_tenant_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_batches_update_tenant_policy ON public.visa_batches FOR UPDATE TO authenticated USING ((public.is_current_platform_user() OR ((company_id = public.current_app_user_company_id()) AND public.current_app_user_has_role(ARRAY['Admin'::text, 'Operations Manager'::text, 'Visa Team'::text])))) WITH CHECK ((public.is_current_platform_user() OR (company_id = public.current_app_user_company_id())));

-- BEGIN GENERATED PRODUCTION ACL SNAPSHOT AND CONSERVATIVE HARDENING
-- Reset target-role privileges first because fresh Supabase projects grant broad defaults.
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agencies FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agency_agreements FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agency_client_access FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agency_company_user_access FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agency_members FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agency_penalties FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agency_score_history FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agency_scores FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_agent_action_locks FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_agent_audit_logs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_agent_jobs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_agent_settings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_agent_worker_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_analysis_jobs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_answers FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_campaign_candidates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_campaigns FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_conversation_turns FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_generation_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_invitation_jobs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_questions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_session_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_sessions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_interview_templates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.candidate_technical_profiles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.candidates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.collections FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.companies FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.company_agency_access FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.company_agency_users FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.company_email_settings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.countries FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.demobilizations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.education_institutions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.email_logs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.email_templates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.employees FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.interviews FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.invoice_items FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.invoices FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.local_content_project_targets FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.local_content_settings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.marketplace_deal_workers FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.marketplace_deals FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.marketplace_requests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.mobilizations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.notification_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.onboarding_validations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.platform_clients FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.profession_aliases FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.professions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.request_audit_logs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.request_lines FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.requests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.subscription_invoices FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.system_activity_logs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.system_backups FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.system_restore_requests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidate_certifications FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidate_consents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidate_documents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidate_education FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidate_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidate_experience FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidate_skills FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_candidates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_cv_analysis_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.talent_resume_versions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.visa_allocations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.visa_authorizations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.visa_batch_lines FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.visa_batches FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_agent_hourly_activity FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.local_content_project_targets_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.marketplace_deal_workers_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.notification_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.request_no_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_agent_emergency_stop(p_company_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_agent_hourly_action_count(p_company_id uuid, p_actor text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_agent_release_lock(p_company_id uuid, p_action_key text, p_status text, p_error_message text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text, p_related_table text, p_related_id text, p_agency_id uuid, p_cooldown_minutes integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_interview_campaign_apply_delivery_settings() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_interview_delivery_preflight() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_interview_enforce_campaign_delivery_on_session() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_interview_sync_linked_session_delivery(p_session_id uuid, p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_request_no_before_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.calculate_candidate_technical_score(p_education_score numeric, p_experience_score numeric, p_skills_score numeric, p_certification_score numeric, p_language_score numeric, p_data_completeness_score numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_ai_interview_invitation_jobs(p_limit integer, p_worker text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_ai_interview_invitation_job(p_job_id uuid, p_message_id text, p_provider text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_onboarding_validation_from_candidate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_agency_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_company_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_user_agency_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_user_company_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_user_has_role(allowed_roles text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_user_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_log_actor() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_ai_interview_analysis_on_completion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_ai_interview_invitation_job(p_job_id uuid, p_error text, p_retry_delay_minutes integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.generate_request_no() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_ai_interview_invitation_queue_summary(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_authenticated_app_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_candidate_interview_priority(p_score numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_owner_talent_dashboard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_talent_public_stats() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_agency_company_user_access() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_company_agency_access() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_platform_user_roles() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_users_security() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_talent_candidate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_agency_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_company_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_current_platform_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_platform_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_manageable_app_users() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_system_activity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_request_no() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_ai_interview_template_version(p_template_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refresh_ai_interview_campaign_counts(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_ai_interview_campaign_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_ai_interview_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_onboarding_validations_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_ai_interview_session_to_campaign() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.talent_after_candidate_profile_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.talent_after_profile_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.talent_calculate_profile_completeness(p_candidate_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.talent_guard_managed_fields() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.talent_is_privileged_actor() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.talent_refresh_profile_completeness(p_candidate_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.talent_set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_refresh_ai_interview_campaign_counts() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;

-- Exact current Production object ACL statements (schema, tables, sequences, functions).
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
REVOKE ALL ON FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) TO authenticated;
GRANT ALL ON FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) TO service_role;
GRANT ALL ON FUNCTION public.ai_agent_emergency_stop(p_company_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ai_agent_emergency_stop(p_company_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ai_agent_emergency_stop(p_company_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.ai_agent_hourly_action_count(p_company_id uuid, p_actor text) TO anon;
GRANT ALL ON FUNCTION public.ai_agent_hourly_action_count(p_company_id uuid, p_actor text) TO authenticated;
GRANT ALL ON FUNCTION public.ai_agent_hourly_action_count(p_company_id uuid, p_actor text) TO service_role;
GRANT ALL ON FUNCTION public.ai_agent_release_lock(p_company_id uuid, p_action_key text, p_status text, p_error_message text) TO anon;
GRANT ALL ON FUNCTION public.ai_agent_release_lock(p_company_id uuid, p_action_key text, p_status text, p_error_message text) TO authenticated;
GRANT ALL ON FUNCTION public.ai_agent_release_lock(p_company_id uuid, p_action_key text, p_status text, p_error_message text) TO service_role;
GRANT ALL ON FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text, p_related_table text, p_related_id text, p_agency_id uuid, p_cooldown_minutes integer) TO anon;
GRANT ALL ON FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text, p_related_table text, p_related_id text, p_agency_id uuid, p_cooldown_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text, p_related_table text, p_related_id text, p_agency_id uuid, p_cooldown_minutes integer) TO service_role;
GRANT ALL ON FUNCTION public.ai_interview_campaign_apply_delivery_settings() TO anon;
GRANT ALL ON FUNCTION public.ai_interview_campaign_apply_delivery_settings() TO authenticated;
GRANT ALL ON FUNCTION public.ai_interview_campaign_apply_delivery_settings() TO service_role;
GRANT ALL ON FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger() TO anon;
GRANT ALL ON FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger() TO authenticated;
GRANT ALL ON FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger() TO service_role;
GRANT ALL ON FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger() TO anon;
GRANT ALL ON FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger() TO authenticated;
GRANT ALL ON FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger() TO service_role;
REVOKE ALL ON FUNCTION public.ai_interview_delivery_preflight() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ai_interview_delivery_preflight() TO anon;
GRANT ALL ON FUNCTION public.ai_interview_delivery_preflight() TO authenticated;
GRANT ALL ON FUNCTION public.ai_interview_delivery_preflight() TO service_role;
GRANT ALL ON FUNCTION public.ai_interview_enforce_campaign_delivery_on_session() TO anon;
GRANT ALL ON FUNCTION public.ai_interview_enforce_campaign_delivery_on_session() TO authenticated;
GRANT ALL ON FUNCTION public.ai_interview_enforce_campaign_delivery_on_session() TO service_role;
GRANT ALL ON FUNCTION public.ai_interview_sync_linked_session_delivery(p_session_id uuid, p_campaign_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ai_interview_sync_linked_session_delivery(p_session_id uuid, p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ai_interview_sync_linked_session_delivery(p_session_id uuid, p_campaign_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.assign_request_no_before_insert() TO anon;
GRANT ALL ON FUNCTION public.assign_request_no_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.assign_request_no_before_insert() TO service_role;
GRANT ALL ON FUNCTION public.calculate_candidate_technical_score(p_education_score numeric, p_experience_score numeric, p_skills_score numeric, p_certification_score numeric, p_language_score numeric, p_data_completeness_score numeric) TO anon;
GRANT ALL ON FUNCTION public.calculate_candidate_technical_score(p_education_score numeric, p_experience_score numeric, p_skills_score numeric, p_certification_score numeric, p_language_score numeric, p_data_completeness_score numeric) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_candidate_technical_score(p_education_score numeric, p_experience_score numeric, p_skills_score numeric, p_certification_score numeric, p_language_score numeric, p_data_completeness_score numeric) TO service_role;
GRANT ALL ON TABLE public.ai_interview_analysis_jobs TO service_role;
REVOKE ALL ON FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text) TO anon;
GRANT ALL ON FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text) TO service_role;
GRANT ALL ON TABLE public.ai_interview_invitation_jobs TO authenticated;
GRANT ALL ON TABLE public.ai_interview_invitation_jobs TO service_role;
REVOKE ALL ON FUNCTION public.claim_ai_interview_invitation_jobs(p_limit integer, p_worker text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_ai_interview_invitation_jobs(p_limit integer, p_worker text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb) TO anon;
GRANT ALL ON FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.complete_ai_interview_invitation_job(p_job_id uuid, p_message_id text, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_ai_interview_invitation_job(p_job_id uuid, p_message_id text, p_provider text) TO service_role;
GRANT ALL ON FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text) TO anon;
GRANT ALL ON FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text) TO service_role;
GRANT ALL ON FUNCTION public.create_onboarding_validation_from_candidate() TO anon;
GRANT ALL ON FUNCTION public.create_onboarding_validation_from_candidate() TO authenticated;
GRANT ALL ON FUNCTION public.create_onboarding_validation_from_candidate() TO service_role;
GRANT ALL ON FUNCTION public.current_app_agency_id() TO anon;
GRANT ALL ON FUNCTION public.current_app_agency_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_agency_id() TO service_role;
GRANT ALL ON FUNCTION public.current_app_company_id() TO anon;
GRANT ALL ON FUNCTION public.current_app_company_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_company_id() TO service_role;
GRANT ALL ON FUNCTION public.current_app_role() TO anon;
GRANT ALL ON FUNCTION public.current_app_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_role() TO service_role;
GRANT ALL ON FUNCTION public.current_app_user_agency_id() TO anon;
GRANT ALL ON FUNCTION public.current_app_user_agency_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_agency_id() TO service_role;
GRANT ALL ON FUNCTION public.current_app_user_company_id() TO anon;
GRANT ALL ON FUNCTION public.current_app_user_company_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_company_id() TO service_role;
GRANT ALL ON FUNCTION public.current_app_user_has_role(allowed_roles text[]) TO anon;
GRANT ALL ON FUNCTION public.current_app_user_has_role(allowed_roles text[]) TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_has_role(allowed_roles text[]) TO service_role;
GRANT ALL ON FUNCTION public.current_app_user_id() TO anon;
GRANT ALL ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_id() TO service_role;
GRANT ALL ON FUNCTION public.current_app_user_role() TO anon;
GRANT ALL ON FUNCTION public.current_app_user_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_role() TO service_role;
REVOKE ALL ON FUNCTION public.current_log_actor() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_log_actor() TO service_role;
GRANT ALL ON FUNCTION public.current_log_actor() TO authenticated;
REVOKE ALL ON FUNCTION public.enqueue_ai_interview_analysis_on_completion() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_ai_interview_analysis_on_completion() TO anon;
GRANT ALL ON FUNCTION public.enqueue_ai_interview_analysis_on_completion() TO authenticated;
GRANT ALL ON FUNCTION public.enqueue_ai_interview_analysis_on_completion() TO service_role;
REVOKE ALL ON FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) TO anon;
GRANT ALL ON FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) TO authenticated;
GRANT ALL ON FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) TO service_role;
REVOKE ALL ON FUNCTION public.fail_ai_interview_invitation_job(p_job_id uuid, p_error text, p_retry_delay_minutes integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_ai_interview_invitation_job(p_job_id uuid, p_error text, p_retry_delay_minutes integer) TO service_role;
GRANT ALL ON FUNCTION public.generate_request_no() TO anon;
GRANT ALL ON FUNCTION public.generate_request_no() TO authenticated;
GRANT ALL ON FUNCTION public.generate_request_no() TO service_role;
REVOKE ALL ON FUNCTION public.get_ai_interview_invitation_queue_summary(p_campaign_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_ai_interview_invitation_queue_summary(p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_ai_interview_invitation_queue_summary(p_campaign_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_authenticated_app_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_authenticated_app_user() TO service_role;
GRANT ALL ON FUNCTION public.get_authenticated_app_user() TO authenticated;
GRANT ALL ON FUNCTION public.get_candidate_interview_priority(p_score numeric) TO anon;
GRANT ALL ON FUNCTION public.get_candidate_interview_priority(p_score numeric) TO authenticated;
GRANT ALL ON FUNCTION public.get_candidate_interview_priority(p_score numeric) TO service_role;
REVOKE ALL ON FUNCTION public.get_owner_talent_dashboard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_owner_talent_dashboard() TO authenticated;
GRANT ALL ON FUNCTION public.get_owner_talent_dashboard() TO service_role;
REVOKE ALL ON FUNCTION public.get_talent_public_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_talent_public_stats() TO anon;
GRANT ALL ON FUNCTION public.get_talent_public_stats() TO authenticated;
GRANT ALL ON FUNCTION public.get_talent_public_stats() TO service_role;
GRANT ALL ON FUNCTION public.guard_agency_company_user_access() TO anon;
GRANT ALL ON FUNCTION public.guard_agency_company_user_access() TO authenticated;
GRANT ALL ON FUNCTION public.guard_agency_company_user_access() TO service_role;
GRANT ALL ON FUNCTION public.guard_company_agency_access() TO anon;
GRANT ALL ON FUNCTION public.guard_company_agency_access() TO authenticated;
GRANT ALL ON FUNCTION public.guard_company_agency_access() TO service_role;
GRANT ALL ON FUNCTION public.guard_platform_user_roles() TO anon;
GRANT ALL ON FUNCTION public.guard_platform_user_roles() TO authenticated;
GRANT ALL ON FUNCTION public.guard_platform_user_roles() TO service_role;
GRANT ALL ON FUNCTION public.guard_users_security() TO anon;
GRANT ALL ON FUNCTION public.guard_users_security() TO authenticated;
GRANT ALL ON FUNCTION public.guard_users_security() TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_talent_candidate() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_talent_candidate() TO service_role;
GRANT ALL ON FUNCTION public.is_agency_user() TO anon;
GRANT ALL ON FUNCTION public.is_agency_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_agency_user() TO service_role;
GRANT ALL ON FUNCTION public.is_company_user() TO anon;
GRANT ALL ON FUNCTION public.is_company_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_company_user() TO service_role;
GRANT ALL ON FUNCTION public.is_current_platform_user() TO anon;
GRANT ALL ON FUNCTION public.is_current_platform_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_current_platform_user() TO service_role;
GRANT ALL ON FUNCTION public.is_platform_user() TO anon;
GRANT ALL ON FUNCTION public.is_platform_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_platform_user() TO service_role;
REVOKE ALL ON FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text) TO authenticated;
GRANT ALL ON FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text) TO service_role;
REVOKE ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) TO service_role;
GRANT ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) TO anon;
GRANT ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) TO authenticated;
REVOKE ALL ON FUNCTION public.list_manageable_app_users() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_manageable_app_users() TO service_role;
GRANT ALL ON FUNCTION public.list_manageable_app_users() TO authenticated;
GRANT ALL ON FUNCTION public.log_system_activity() TO anon;
GRANT ALL ON FUNCTION public.log_system_activity() TO authenticated;
GRANT ALL ON FUNCTION public.log_system_activity() TO service_role;
GRANT ALL ON FUNCTION public.next_request_no() TO anon;
GRANT ALL ON FUNCTION public.next_request_no() TO authenticated;
GRANT ALL ON FUNCTION public.next_request_no() TO service_role;
GRANT ALL ON FUNCTION public.publish_ai_interview_template_version(p_template_id uuid) TO anon;
GRANT ALL ON FUNCTION public.publish_ai_interview_template_version(p_template_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.publish_ai_interview_template_version(p_template_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.refresh_ai_interview_campaign_counts(p_campaign_id uuid) TO anon;
GRANT ALL ON FUNCTION public.refresh_ai_interview_campaign_counts(p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.refresh_ai_interview_campaign_counts(p_campaign_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.set_ai_interview_campaign_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_ai_interview_campaign_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_ai_interview_campaign_updated_at() TO service_role;
GRANT ALL ON FUNCTION public.set_ai_interview_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_ai_interview_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_ai_interview_updated_at() TO service_role;
GRANT ALL ON FUNCTION public.set_onboarding_validations_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_onboarding_validations_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_onboarding_validations_updated_at() TO service_role;
GRANT ALL ON FUNCTION public.sync_ai_interview_session_to_campaign() TO anon;
GRANT ALL ON FUNCTION public.sync_ai_interview_session_to_campaign() TO authenticated;
GRANT ALL ON FUNCTION public.sync_ai_interview_session_to_campaign() TO service_role;
REVOKE ALL ON FUNCTION public.talent_after_candidate_profile_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.talent_after_candidate_profile_change() TO service_role;
REVOKE ALL ON FUNCTION public.talent_after_profile_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.talent_after_profile_change() TO service_role;
REVOKE ALL ON FUNCTION public.talent_calculate_profile_completeness(p_candidate_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.talent_calculate_profile_completeness(p_candidate_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.talent_guard_managed_fields() FROM PUBLIC;
GRANT ALL ON FUNCTION public.talent_guard_managed_fields() TO service_role;
REVOKE ALL ON FUNCTION public.talent_is_privileged_actor() FROM PUBLIC;
GRANT ALL ON FUNCTION public.talent_is_privileged_actor() TO service_role;
REVOKE ALL ON FUNCTION public.talent_refresh_profile_completeness(p_candidate_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.talent_refresh_profile_completeness(p_candidate_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.talent_set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.talent_set_updated_at() TO service_role;
GRANT ALL ON FUNCTION public.trg_refresh_ai_interview_campaign_counts() TO anon;
GRANT ALL ON FUNCTION public.trg_refresh_ai_interview_campaign_counts() TO authenticated;
GRANT ALL ON FUNCTION public.trg_refresh_ai_interview_campaign_counts() TO service_role;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;
GRANT ALL ON TABLE public.agencies TO anon;
GRANT ALL ON TABLE public.agencies TO authenticated;
GRANT ALL ON TABLE public.agencies TO service_role;
GRANT ALL ON TABLE public.agency_agreements TO anon;
GRANT ALL ON TABLE public.agency_agreements TO authenticated;
GRANT ALL ON TABLE public.agency_agreements TO service_role;
GRANT ALL ON TABLE public.agency_client_access TO anon;
GRANT ALL ON TABLE public.agency_client_access TO authenticated;
GRANT ALL ON TABLE public.agency_client_access TO service_role;
GRANT ALL ON TABLE public.agency_company_user_access TO anon;
GRANT ALL ON TABLE public.agency_company_user_access TO authenticated;
GRANT ALL ON TABLE public.agency_company_user_access TO service_role;
GRANT ALL ON TABLE public.agency_members TO anon;
GRANT ALL ON TABLE public.agency_members TO authenticated;
GRANT ALL ON TABLE public.agency_members TO service_role;
GRANT ALL ON TABLE public.agency_penalties TO anon;
GRANT ALL ON TABLE public.agency_penalties TO authenticated;
GRANT ALL ON TABLE public.agency_penalties TO service_role;
GRANT ALL ON TABLE public.agency_score_history TO service_role;
GRANT SELECT,INSERT ON TABLE public.agency_score_history TO authenticated;
GRANT ALL ON TABLE public.agency_scores TO anon;
GRANT ALL ON TABLE public.agency_scores TO authenticated;
GRANT ALL ON TABLE public.agency_scores TO service_role;
GRANT ALL ON TABLE public.ai_agent_action_locks TO anon;
GRANT ALL ON TABLE public.ai_agent_action_locks TO authenticated;
GRANT ALL ON TABLE public.ai_agent_action_locks TO service_role;
GRANT ALL ON TABLE public.ai_agent_audit_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.ai_agent_audit_logs TO authenticated;
GRANT ALL ON TABLE public.ai_agent_hourly_activity TO anon;
GRANT ALL ON TABLE public.ai_agent_hourly_activity TO authenticated;
GRANT ALL ON TABLE public.ai_agent_hourly_activity TO service_role;
GRANT ALL ON TABLE public.ai_agent_jobs TO anon;
GRANT ALL ON TABLE public.ai_agent_jobs TO authenticated;
GRANT ALL ON TABLE public.ai_agent_jobs TO service_role;
GRANT ALL ON TABLE public.ai_agent_settings TO anon;
GRANT ALL ON TABLE public.ai_agent_settings TO authenticated;
GRANT ALL ON TABLE public.ai_agent_settings TO service_role;
GRANT ALL ON TABLE public.ai_agent_worker_runs TO anon;
GRANT ALL ON TABLE public.ai_agent_worker_runs TO authenticated;
GRANT ALL ON TABLE public.ai_agent_worker_runs TO service_role;
GRANT ALL ON TABLE public.ai_interview_answers TO anon;
GRANT ALL ON TABLE public.ai_interview_answers TO authenticated;
GRANT ALL ON TABLE public.ai_interview_answers TO service_role;
GRANT ALL ON TABLE public.ai_interview_campaign_candidates TO authenticated;
GRANT ALL ON TABLE public.ai_interview_campaign_candidates TO service_role;
GRANT ALL ON TABLE public.ai_interview_campaigns TO authenticated;
GRANT ALL ON TABLE public.ai_interview_campaigns TO service_role;
GRANT ALL ON TABLE public.ai_interview_conversation_turns TO anon;
GRANT ALL ON TABLE public.ai_interview_conversation_turns TO authenticated;
GRANT ALL ON TABLE public.ai_interview_conversation_turns TO service_role;
GRANT ALL ON TABLE public.ai_interview_generation_runs TO anon;
GRANT ALL ON TABLE public.ai_interview_generation_runs TO authenticated;
GRANT ALL ON TABLE public.ai_interview_generation_runs TO service_role;
GRANT ALL ON TABLE public.ai_interview_questions TO anon;
GRANT ALL ON TABLE public.ai_interview_questions TO authenticated;
GRANT ALL ON TABLE public.ai_interview_questions TO service_role;
GRANT ALL ON TABLE public.ai_interview_session_events TO anon;
GRANT ALL ON TABLE public.ai_interview_session_events TO authenticated;
GRANT ALL ON TABLE public.ai_interview_session_events TO service_role;
GRANT ALL ON TABLE public.ai_interview_sessions TO anon;
GRANT ALL ON TABLE public.ai_interview_sessions TO authenticated;
GRANT ALL ON TABLE public.ai_interview_sessions TO service_role;
GRANT ALL ON TABLE public.ai_interview_templates TO anon;
GRANT ALL ON TABLE public.ai_interview_templates TO authenticated;
GRANT ALL ON TABLE public.ai_interview_templates TO service_role;
GRANT ALL ON TABLE public.candidate_technical_profiles TO anon;
GRANT ALL ON TABLE public.candidate_technical_profiles TO authenticated;
GRANT ALL ON TABLE public.candidate_technical_profiles TO service_role;
GRANT ALL ON TABLE public.candidates TO authenticated;
GRANT ALL ON TABLE public.candidates TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.candidates TO anon;
GRANT ALL ON TABLE public.collections TO anon;
GRANT ALL ON TABLE public.collections TO authenticated;
GRANT ALL ON TABLE public.collections TO service_role;
GRANT ALL ON SEQUENCE public.collections_id_seq TO anon;
GRANT ALL ON SEQUENCE public.collections_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.collections_id_seq TO service_role;
GRANT ALL ON TABLE public.companies TO anon;
GRANT ALL ON TABLE public.companies TO authenticated;
GRANT ALL ON TABLE public.companies TO service_role;
GRANT ALL ON TABLE public.company_agency_access TO anon;
GRANT ALL ON TABLE public.company_agency_access TO authenticated;
GRANT ALL ON TABLE public.company_agency_access TO service_role;
GRANT ALL ON TABLE public.company_agency_users TO anon;
GRANT ALL ON TABLE public.company_agency_users TO authenticated;
GRANT ALL ON TABLE public.company_agency_users TO service_role;
GRANT ALL ON TABLE public.company_email_settings TO anon;
GRANT ALL ON TABLE public.company_email_settings TO authenticated;
GRANT ALL ON TABLE public.company_email_settings TO service_role;
GRANT ALL ON TABLE public.countries TO anon;
GRANT ALL ON TABLE public.countries TO authenticated;
GRANT ALL ON TABLE public.countries TO service_role;
GRANT ALL ON SEQUENCE public.countries_id_seq TO anon;
GRANT ALL ON SEQUENCE public.countries_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.countries_id_seq TO service_role;
GRANT ALL ON TABLE public.demobilizations TO anon;
GRANT ALL ON TABLE public.demobilizations TO authenticated;
GRANT ALL ON TABLE public.demobilizations TO service_role;
GRANT ALL ON SEQUENCE public.demobilizations_id_seq TO anon;
GRANT ALL ON SEQUENCE public.demobilizations_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.demobilizations_id_seq TO service_role;
GRANT ALL ON TABLE public.education_institutions TO anon;
GRANT ALL ON TABLE public.education_institutions TO authenticated;
GRANT ALL ON TABLE public.education_institutions TO service_role;
GRANT ALL ON TABLE public.email_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.email_logs TO authenticated;
GRANT ALL ON TABLE public.email_templates TO anon;
GRANT ALL ON TABLE public.email_templates TO authenticated;
GRANT ALL ON TABLE public.email_templates TO service_role;
GRANT ALL ON TABLE public.employees TO authenticated;
GRANT ALL ON TABLE public.employees TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.employees TO anon;
GRANT ALL ON SEQUENCE public.employees_id_seq TO anon;
GRANT ALL ON SEQUENCE public.employees_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.employees_id_seq TO service_role;
GRANT ALL ON TABLE public.interviews TO authenticated;
GRANT ALL ON TABLE public.interviews TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.interviews TO anon;
GRANT ALL ON TABLE public.invoice_items TO anon;
GRANT ALL ON TABLE public.invoice_items TO authenticated;
GRANT ALL ON TABLE public.invoice_items TO service_role;
GRANT ALL ON SEQUENCE public.invoice_items_id_seq TO anon;
GRANT ALL ON SEQUENCE public.invoice_items_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.invoice_items_id_seq TO service_role;
GRANT ALL ON TABLE public.invoices TO anon;
GRANT ALL ON TABLE public.invoices TO authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;
GRANT ALL ON SEQUENCE public.invoices_id_seq TO anon;
GRANT ALL ON SEQUENCE public.invoices_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.invoices_id_seq TO service_role;
GRANT ALL ON TABLE public.local_content_project_targets TO anon;
GRANT ALL ON TABLE public.local_content_project_targets TO authenticated;
GRANT ALL ON TABLE public.local_content_project_targets TO service_role;
GRANT ALL ON SEQUENCE public.local_content_project_targets_id_seq TO anon;
GRANT ALL ON SEQUENCE public.local_content_project_targets_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.local_content_project_targets_id_seq TO service_role;
GRANT ALL ON TABLE public.local_content_settings TO anon;
GRANT ALL ON TABLE public.local_content_settings TO authenticated;
GRANT ALL ON TABLE public.local_content_settings TO service_role;
GRANT ALL ON TABLE public.marketplace_deal_workers TO anon;
GRANT ALL ON TABLE public.marketplace_deal_workers TO authenticated;
GRANT ALL ON TABLE public.marketplace_deal_workers TO service_role;
GRANT ALL ON SEQUENCE public.marketplace_deal_workers_id_seq TO anon;
GRANT ALL ON SEQUENCE public.marketplace_deal_workers_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.marketplace_deal_workers_id_seq TO service_role;
GRANT ALL ON TABLE public.marketplace_deals TO anon;
GRANT ALL ON TABLE public.marketplace_deals TO authenticated;
GRANT ALL ON TABLE public.marketplace_deals TO service_role;
GRANT ALL ON SEQUENCE public.marketplace_deals_id_seq TO anon;
GRANT ALL ON SEQUENCE public.marketplace_deals_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.marketplace_deals_id_seq TO service_role;
GRANT ALL ON TABLE public.marketplace_requests TO anon;
GRANT ALL ON TABLE public.marketplace_requests TO authenticated;
GRANT ALL ON TABLE public.marketplace_requests TO service_role;
GRANT ALL ON SEQUENCE public.marketplace_requests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.marketplace_requests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.marketplace_requests_id_seq TO service_role;
GRANT ALL ON TABLE public.mobilizations TO authenticated;
GRANT ALL ON TABLE public.mobilizations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mobilizations TO anon;
GRANT ALL ON SEQUENCE public.mobilizations_id_seq TO anon;
GRANT ALL ON SEQUENCE public.mobilizations_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.mobilizations_id_seq TO service_role;
GRANT ALL ON TABLE public.notification_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_events TO authenticated;
GRANT ALL ON SEQUENCE public.notification_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.notification_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.notification_events_id_seq TO service_role;
GRANT ALL ON TABLE public.onboarding_validations TO anon;
GRANT ALL ON TABLE public.onboarding_validations TO authenticated;
GRANT ALL ON TABLE public.onboarding_validations TO service_role;
GRANT ALL ON TABLE public.platform_clients TO anon;
GRANT ALL ON TABLE public.platform_clients TO authenticated;
GRANT ALL ON TABLE public.platform_clients TO service_role;
GRANT ALL ON TABLE public.profession_aliases TO anon;
GRANT ALL ON TABLE public.profession_aliases TO authenticated;
GRANT ALL ON TABLE public.profession_aliases TO service_role;
GRANT ALL ON SEQUENCE public.profession_aliases_id_seq TO anon;
GRANT ALL ON SEQUENCE public.profession_aliases_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.profession_aliases_id_seq TO service_role;
GRANT ALL ON TABLE public.professions TO anon;
GRANT ALL ON TABLE public.professions TO authenticated;
GRANT ALL ON TABLE public.professions TO service_role;
GRANT ALL ON SEQUENCE public.professions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.professions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.professions_id_seq TO service_role;
GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.request_audit_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.request_audit_logs TO authenticated;
GRANT ALL ON TABLE public.request_lines TO authenticated;
GRANT ALL ON TABLE public.request_lines TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.request_lines TO anon;
GRANT ALL ON SEQUENCE public.request_no_seq TO anon;
GRANT ALL ON SEQUENCE public.request_no_seq TO authenticated;
GRANT ALL ON SEQUENCE public.request_no_seq TO service_role;
GRANT ALL ON TABLE public.requests TO authenticated;
GRANT ALL ON TABLE public.requests TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.requests TO anon;
GRANT ALL ON SEQUENCE public.requests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.requests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.requests_id_seq TO service_role;
GRANT ALL ON TABLE public.subscription_invoices TO anon;
GRANT ALL ON TABLE public.subscription_invoices TO authenticated;
GRANT ALL ON TABLE public.subscription_invoices TO service_role;
GRANT ALL ON TABLE public.support_tickets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_tickets TO authenticated;
GRANT ALL ON TABLE public.system_activity_logs TO service_role;
GRANT SELECT ON TABLE public.system_activity_logs TO authenticated;
GRANT ALL ON TABLE public.system_backups TO service_role;
GRANT SELECT,INSERT,DELETE ON TABLE public.system_backups TO authenticated;
GRANT ALL ON TABLE public.system_restore_requests TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.system_restore_requests TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_certifications TO anon;
GRANT ALL ON TABLE public.talent_candidate_certifications TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_certifications TO service_role;
GRANT ALL ON TABLE public.talent_candidate_consents TO anon;
GRANT ALL ON TABLE public.talent_candidate_consents TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_consents TO service_role;
GRANT ALL ON TABLE public.talent_candidate_documents TO anon;
GRANT ALL ON TABLE public.talent_candidate_documents TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_documents TO service_role;
GRANT ALL ON TABLE public.talent_candidate_education TO anon;
GRANT ALL ON TABLE public.talent_candidate_education TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_education TO service_role;
GRANT ALL ON TABLE public.talent_candidate_events TO service_role;
GRANT SELECT,INSERT ON TABLE public.talent_candidate_events TO authenticated;
GRANT ALL ON SEQUENCE public.talent_candidate_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.talent_candidate_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.talent_candidate_events_id_seq TO service_role;
GRANT ALL ON TABLE public.talent_candidate_experience TO anon;
GRANT ALL ON TABLE public.talent_candidate_experience TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_experience TO service_role;
GRANT ALL ON TABLE public.talent_candidate_skills TO anon;
GRANT ALL ON TABLE public.talent_candidate_skills TO authenticated;
GRANT ALL ON TABLE public.talent_candidate_skills TO service_role;
GRANT ALL ON TABLE public.talent_candidates TO anon;
GRANT ALL ON TABLE public.talent_candidates TO authenticated;
GRANT ALL ON TABLE public.talent_candidates TO service_role;
GRANT ALL ON TABLE public.talent_cv_analysis_runs TO anon;
GRANT ALL ON TABLE public.talent_cv_analysis_runs TO authenticated;
GRANT ALL ON TABLE public.talent_cv_analysis_runs TO service_role;
GRANT ALL ON TABLE public.talent_resume_versions TO anon;
GRANT ALL ON TABLE public.talent_resume_versions TO authenticated;
GRANT ALL ON TABLE public.talent_resume_versions TO service_role;
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON SEQUENCE public.users_id_seq TO anon;
GRANT ALL ON SEQUENCE public.users_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.users_id_seq TO service_role;
GRANT ALL ON TABLE public.visa_allocations TO authenticated;
GRANT ALL ON TABLE public.visa_allocations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visa_allocations TO anon;
GRANT ALL ON SEQUENCE public.visa_allocations_id_seq TO anon;
GRANT ALL ON SEQUENCE public.visa_allocations_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.visa_allocations_id_seq TO service_role;
GRANT ALL ON TABLE public.visa_authorizations TO authenticated;
GRANT ALL ON TABLE public.visa_authorizations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visa_authorizations TO anon;
GRANT ALL ON TABLE public.visa_batch_lines TO authenticated;
GRANT ALL ON TABLE public.visa_batch_lines TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visa_batch_lines TO anon;
GRANT ALL ON SEQUENCE public.visa_batch_lines_id_seq TO anon;
GRANT ALL ON SEQUENCE public.visa_batch_lines_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.visa_batch_lines_id_seq TO service_role;
GRANT ALL ON TABLE public.visa_batches TO authenticated;
GRANT ALL ON TABLE public.visa_batches TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.visa_batches TO anon;

-- Do not copy ALTER DEFAULT PRIVILEGES: Staging platform defaults were verified separately.
-- Fail closed for every Production table that currently lacks RLS, except users (ACL-only internal).
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.users TO service_role;
REVOKE ALL ON TABLE public.agency_agreements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agency_agreements TO service_role;
ALTER TABLE public.agency_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.agency_agreements FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.agency_client_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agency_client_access TO service_role;
ALTER TABLE public.agency_client_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.agency_client_access FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.agency_company_user_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agency_company_user_access TO service_role;
ALTER TABLE public.agency_company_user_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.agency_company_user_access FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.agency_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agency_members TO service_role;
ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.agency_members FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.agency_penalties FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agency_penalties TO service_role;
ALTER TABLE public.agency_penalties ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.agency_penalties FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.agency_scores FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agency_scores TO service_role;
ALTER TABLE public.agency_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.agency_scores FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_agent_action_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_agent_action_locks TO service_role;
 CREATE POLICY baseline_deny_all_until_review ON public.ai_agent_action_locks FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_agent_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_agent_jobs TO service_role;
 CREATE POLICY baseline_deny_all_until_review ON public.ai_agent_jobs FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_agent_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_agent_settings TO service_role;
ALTER TABLE public.ai_agent_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.ai_agent_settings FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_agent_worker_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_agent_worker_runs TO service_role;
 CREATE POLICY baseline_deny_all_until_review ON public.ai_agent_worker_runs FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_interview_answers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_interview_answers TO service_role;
ALTER TABLE public.ai_interview_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.ai_interview_answers FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_interview_generation_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_interview_generation_runs TO service_role;
 CREATE POLICY baseline_deny_all_until_review ON public.ai_interview_generation_runs FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_interview_questions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_interview_questions TO service_role;
ALTER TABLE public.ai_interview_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.ai_interview_questions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_interview_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_interview_sessions TO service_role;
ALTER TABLE public.ai_interview_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.ai_interview_sessions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.ai_interview_templates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_interview_templates TO service_role;
ALTER TABLE public.ai_interview_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.ai_interview_templates FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.candidate_technical_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.candidate_technical_profiles TO service_role;
ALTER TABLE public.candidate_technical_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.candidate_technical_profiles FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.candidates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.candidates TO service_role;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.candidates FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.collections FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.collections TO service_role;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.collections FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.companies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.companies FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.company_agency_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.company_agency_access TO service_role;
ALTER TABLE public.company_agency_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.company_agency_access FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.company_agency_users FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.company_agency_users TO service_role;
ALTER TABLE public.company_agency_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.company_agency_users FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.company_email_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.company_email_settings TO service_role;
ALTER TABLE public.company_email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.company_email_settings FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.demobilizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.demobilizations TO service_role;
ALTER TABLE public.demobilizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.demobilizations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.education_institutions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.education_institutions TO service_role;
ALTER TABLE public.education_institutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.education_institutions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.email_templates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.email_templates FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.employees FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.employees FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.interviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.interviews TO service_role;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.interviews FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.invoice_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.invoice_items FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.invoices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.invoices FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.local_content_project_targets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.local_content_project_targets TO service_role;
ALTER TABLE public.local_content_project_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.local_content_project_targets FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.local_content_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.local_content_settings TO service_role;
ALTER TABLE public.local_content_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.local_content_settings FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.marketplace_deal_workers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.marketplace_deal_workers TO service_role;
ALTER TABLE public.marketplace_deal_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.marketplace_deal_workers FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.marketplace_deals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.marketplace_deals TO service_role;
ALTER TABLE public.marketplace_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.marketplace_deals FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.marketplace_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.marketplace_requests TO service_role;
ALTER TABLE public.marketplace_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.marketplace_requests FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.mobilizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mobilizations TO service_role;
ALTER TABLE public.mobilizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.mobilizations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.onboarding_validations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.onboarding_validations TO service_role;
ALTER TABLE public.onboarding_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.onboarding_validations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.platform_clients FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_clients TO service_role;
 CREATE POLICY baseline_deny_all_until_review ON public.platform_clients FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.profession_aliases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profession_aliases TO service_role;
ALTER TABLE public.profession_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.profession_aliases FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.request_lines FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.request_lines TO service_role;
ALTER TABLE public.request_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.request_lines FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.requests TO service_role;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.requests FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.subscription_invoices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.subscription_invoices TO service_role;
ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.subscription_invoices FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.visa_allocations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.visa_allocations TO service_role;
ALTER TABLE public.visa_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.visa_allocations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.visa_authorizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.visa_authorizations TO service_role;
ALTER TABLE public.visa_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.visa_authorizations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.visa_batch_lines FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.visa_batch_lines TO service_role;
ALTER TABLE public.visa_batch_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.visa_batch_lines FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.visa_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.visa_batches TO service_role;
ALTER TABLE public.visa_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_deny_all_until_review ON public.visa_batches FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- SECURITY DEFINER hardening: deny by default, then grant only reviewed entry points.
REVOKE ALL ON FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) TO service_role;
REVOKE ALL ON FUNCTION public.ai_agent_emergency_stop(p_company_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_agent_emergency_stop(p_company_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ai_agent_release_lock(p_company_id uuid, p_action_key text, p_status text, p_error_message text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_agent_release_lock(p_company_id uuid, p_action_key text, p_status text, p_error_message text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text, p_related_table text, p_related_id text, p_agency_id uuid, p_cooldown_minutes integer) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text, p_related_table text, p_related_id text, p_agency_id uuid, p_cooldown_minutes integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_interview_campaign_candidate_sync_session_trigger() TO service_role;
REVOKE ALL ON FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_interview_campaign_sync_delivery_to_sessions_trigger() TO service_role;
REVOKE ALL ON FUNCTION public.ai_interview_delivery_preflight() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_interview_delivery_preflight() TO service_role;
REVOKE ALL ON FUNCTION public.ai_interview_enforce_campaign_delivery_on_session() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_interview_enforce_campaign_delivery_on_session() TO service_role;
REVOKE ALL ON FUNCTION public.ai_interview_sync_linked_session_delivery(p_session_id uuid, p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.ai_interview_sync_linked_session_delivery(p_session_id uuid, p_campaign_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.assign_request_no_before_insert() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.assign_request_no_before_insert() TO service_role;
REVOKE ALL ON FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.claim_ai_interview_analysis_job(p_worker_name text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_ai_interview_invitation_jobs(p_limit integer, p_worker text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.claim_ai_interview_invitation_jobs(p_limit integer, p_worker text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.complete_ai_interview_analysis_job(p_job_id uuid, p_result jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.complete_ai_interview_invitation_job(p_job_id uuid, p_message_id text, p_provider text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.complete_ai_interview_invitation_job(p_job_id uuid, p_message_id text, p_provider text) TO service_role;
REVOKE ALL ON FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text) TO service_role;
REVOKE ALL ON FUNCTION public.current_app_agency_id() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_agency_id() TO service_role;
REVOKE ALL ON FUNCTION public.current_app_company_id() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_company_id() TO service_role;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_role() TO service_role;
REVOKE ALL ON FUNCTION public.current_app_user_agency_id() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_user_agency_id() TO service_role;
REVOKE ALL ON FUNCTION public.current_app_user_company_id() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_user_company_id() TO service_role;
REVOKE ALL ON FUNCTION public.current_app_user_has_role(allowed_roles text[]) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_user_has_role(allowed_roles text[]) TO service_role;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_user_id() TO service_role;
REVOKE ALL ON FUNCTION public.current_app_user_role() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_app_user_role() TO service_role;
REVOKE ALL ON FUNCTION public.current_log_actor() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.current_log_actor() TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_ai_interview_analysis_on_completion() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.enqueue_ai_interview_analysis_on_completion() TO service_role;
REVOKE ALL ON FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.fail_ai_interview_analysis_job(p_job_id uuid, p_error text) TO service_role;
REVOKE ALL ON FUNCTION public.fail_ai_interview_invitation_job(p_job_id uuid, p_error text, p_retry_delay_minutes integer) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.fail_ai_interview_invitation_job(p_job_id uuid, p_error text, p_retry_delay_minutes integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_ai_interview_invitation_queue_summary(p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.get_ai_interview_invitation_queue_summary(p_campaign_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_authenticated_app_user() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.get_authenticated_app_user() TO service_role;
REVOKE ALL ON FUNCTION public.get_owner_talent_dashboard() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.get_owner_talent_dashboard() TO service_role;
REVOKE ALL ON FUNCTION public.get_talent_public_stats() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.get_talent_public_stats() TO service_role;
REVOKE ALL ON FUNCTION public.guard_agency_company_user_access() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.guard_agency_company_user_access() TO service_role;
REVOKE ALL ON FUNCTION public.guard_company_agency_access() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.guard_company_agency_access() TO service_role;
REVOKE ALL ON FUNCTION public.guard_platform_user_roles() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.guard_platform_user_roles() TO service_role;
REVOKE ALL ON FUNCTION public.guard_users_security() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.guard_users_security() TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_talent_candidate() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.handle_new_talent_candidate() TO service_role;
REVOKE ALL ON FUNCTION public.is_agency_user() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_agency_user() TO service_role;
REVOKE ALL ON FUNCTION public.is_company_user() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_company_user() TO service_role;
REVOKE ALL ON FUNCTION public.is_current_platform_user() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_current_platform_user() TO service_role;
REVOKE ALL ON FUNCTION public.is_platform_user() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_platform_user() TO service_role;
REVOKE ALL ON FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text) TO service_role;
REVOKE ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) TO service_role;
REVOKE ALL ON FUNCTION public.list_manageable_app_users() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.list_manageable_app_users() TO service_role;
REVOKE ALL ON FUNCTION public.log_system_activity() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.log_system_activity() TO service_role;
REVOKE ALL ON FUNCTION public.next_request_no() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.next_request_no() TO service_role;
REVOKE ALL ON FUNCTION public.publish_ai_interview_template_version(p_template_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.publish_ai_interview_template_version(p_template_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.queue_ai_interview_analysis(p_session_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_ai_interview_campaign_counts(p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.refresh_ai_interview_campaign_counts(p_campaign_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sync_ai_interview_session_to_campaign() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.sync_ai_interview_session_to_campaign() TO service_role;
REVOKE ALL ON FUNCTION public.talent_after_candidate_profile_change() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.talent_after_candidate_profile_change() TO service_role;
REVOKE ALL ON FUNCTION public.talent_after_profile_change() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.talent_after_profile_change() TO service_role;
REVOKE ALL ON FUNCTION public.talent_calculate_profile_completeness(p_candidate_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.talent_calculate_profile_completeness(p_candidate_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.talent_guard_managed_fields() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.talent_guard_managed_fields() TO service_role;
REVOKE ALL ON FUNCTION public.talent_is_privileged_actor() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.talent_is_privileged_actor() TO service_role;
REVOKE ALL ON FUNCTION public.talent_refresh_profile_completeness(p_candidate_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.talent_refresh_profile_completeness(p_candidate_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_refresh_ai_interview_campaign_counts() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.trg_refresh_ai_interview_campaign_counts() TO service_role;
GRANT ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) TO anon;
GRANT ALL ON FUNCTION public.get_talent_public_stats() TO anon;
GRANT ALL ON FUNCTION public.add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[]) TO authenticated;
GRANT ALL ON FUNCTION public.ai_agent_try_acquire_lock(p_company_id uuid, p_action_key text, p_action_type text, p_related_table text, p_related_id text, p_agency_id uuid, p_cooldown_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION public.ai_interview_delivery_preflight() TO authenticated;
GRANT ALL ON FUNCTION public.create_ai_interview_template_version(p_template_id uuid, p_version_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.get_authenticated_app_user() TO authenticated;
GRANT ALL ON FUNCTION public.get_talent_public_stats() TO authenticated;
GRANT ALL ON FUNCTION public.launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text) TO authenticated;
GRANT ALL ON FUNCTION public.legacy_app_login(p_email text, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.list_manageable_app_users() TO authenticated;
GRANT ALL ON FUNCTION public.remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.revalidate_ai_interview_campaign_candidates(p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.current_app_company_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_agency_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_company_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_has_role(allowed_roles text[]) TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_user_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_log_actor() TO authenticated;
GRANT ALL ON FUNCTION public.is_agency_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_company_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_current_platform_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_platform_user() TO authenticated;
-- END GENERATED PRODUCTION ACL SNAPSHOT AND CONSERVATIVE HARDENING
