import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../supabase/migrations/20260816000100_communication_reliability_hiring_pipeline.sql", import.meta.url);

test("communication reliability and hiring pipeline migration parses in PostgreSQL", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema extensions; create schema vault; create schema net; create schema cron;
    create role anon; create role authenticated; create role service_role;
    create table public.companies(id uuid primary key, name text);
    create table public.agencies(id uuid primary key);
    create table public.users(id bigint primary key, auth_user_id uuid, email text, role text, status text, is_active boolean, company_id uuid, agency_id uuid);
    create table public.email_logs(
      id uuid primary key default gen_random_uuid(), company_id uuid, agency_id uuid, user_id bigint,
      event_type text, type text, status text, recipient text, to_email text, to_emails text,
      subject text, provider text, provider_message_id text, message_id text, error_code text,
      error_message text, retry_count integer default 0, created_at timestamptz default now(),
      sent_at timestamptz, failed_at timestamptz, idempotency_key text, related_id text,
      from_email text, dispatch_claimed_at timestamptz
    );
    create unique index email_logs_company_idempotency_unique on public.email_logs(company_id,idempotency_key) where idempotency_key is not null;
    create table public.talent_imported_prospects(
      id uuid primary key, email text, full_name text, current_title text, source_job_title text,
      marketplace_profile_consent boolean default true, claimed_candidate_id uuid
    );
    create table public.talent_candidates(
      id uuid primary key, full_name text, public_reference text, profession text,
      marketplace_status text, is_verified boolean, employer_contact_sharing_consent boolean
    );
    create table public.candidates(id uuid primary key, company_id uuid, candidate_name text, profession text);
    create table public.talent_company_contact_requests(
      id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
      prospect_id uuid not null references public.talent_imported_prospects(id), requested_by_auth_user_id uuid not null,
      company_name_snapshot text not null, decision_token uuid not null default gen_random_uuid(), status text not null default 'Pending',
      expires_at timestamptz not null default now() + interval '14 days', requested_at timestamptz default now(), decided_at timestamptz,
      email_delivery_status text not null default 'Queued', email_last_attempt_at timestamptz,
      email_provider_message_id text, email_error_message text, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    create table cron.job(jobid bigint, jobname text);
    create function cron.unschedule(bigint) returns boolean language sql as $$ select true $$;
    create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function public.current_app_user_company_id() returns uuid language sql stable as $$ select null::uuid $$;
    create function public.current_app_user_has_role(text[]) returns boolean language sql stable as $$ select true $$;
  `);
  const migration = await readFile(migrationUrl, "utf8");
  await db.exec(migration);
  const result = await db.query(`select count(*)::integer as count from pg_proc where proname in ('claim_email_retry_jobs','list_company_hiring_pipeline','move_company_hiring_stage')`);
  assert.equal(result.rows[0].count, 3);
  await db.close();
});
