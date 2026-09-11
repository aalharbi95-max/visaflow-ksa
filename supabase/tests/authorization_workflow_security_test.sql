-- Run only against a disposable local Supabase database after migrations:
--   supabase test db
begin;
select plan(14);

select has_function(
  'public', 'authorization_workflow_mutate', array['text','uuid','jsonb','text'],
  'atomic Authorization RPC exists'
);
select function_privs_are(
  'public', 'authorization_workflow_mutate', array['text','uuid','jsonb','text'],
  'authenticated', array['EXECUTE'], 'authenticated can call guarded workflow RPC'
);
select function_privs_are(
  'public', 'authorization_workflow_mutate', array['text','uuid','jsonb','text'],
  'anon', array[]::text[], 'anon cannot call workflow RPC'
);
select function_privs_are(
  'public', 'authorization_workflow_notify',
  array['public.visa_authorizations','text','text','text'],
  'authenticated', array[]::text[], 'internal notification helper is not browser executable'
);
select is(
  (select proconfig::text from pg_proc where oid =
    'public.authorization_workflow_mutate(text,uuid,jsonb,text)'::regprocedure),
  '{"search_path=\"\""}', 'workflow RPC has an empty search_path'
);
select like(
  pg_get_functiondef('public.authorization_workflow_mutate(text,uuid,jsonb,text)'::regprocedure),
  '%FOR UPDATE%', 'workflow RPC locks rows to serialize send/decision/allocation races'
);
select like(
  pg_get_functiondef('public.authorization_workflow_mutate(text,uuid,jsonb,text)'::regprocedure),
  '%authorization_quantity_exceeds_allocation%',
  'allocation capacity is checked inside the locked transaction'
);
select like(
  pg_get_functiondef('public.authorization_workflow_mutate(text,uuid,jsonb,text)'::regprocedure),
  '%Recruitment Manager%Recruitment Director%',
  'manager/director are notification recipients, not mutation roles'
);
select table_privs_are(
  'public', 'authorization_events', 'authenticated', array['SELECT'],
  'timeline is append-only to browser clients'
);
select table_privs_are(
  'public', 'notification_events', 'authenticated', array['SELECT'],
  'notifications reject direct browser writes'
);
select policies_are(
  'public', 'authorization_events', array['authorization_events_select_prelaunch_workflow'],
  'timeline has one tenant-scoped read policy'
);
select policies_are(
  'public', 'notification_events', array['notification_events_recipient_select'],
  'notification reads are recipient targeted'
);
select col_is_unique(
  'public', 'authorization_events', array['authorization_id','idempotency_key'],
  'each mutation event is idempotent per Authorization'
);
select like(
  pg_get_functiondef('public.notification_event_mutate(text,bigint,jsonb)'::regprocedure),
  '%agency_company_user_access%',
  'agency notification mutations validate active membership'
);

select * from finish();
rollback;
