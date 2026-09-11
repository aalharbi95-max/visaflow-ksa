# Sprint 1 authorization workflow rollback

Use this plan only after taking a database backup and stopping workflow traffic.
It is intentionally not automated because dropping audit data is destructive.

1. Revoke `authorization_workflow_mutate` and `notification_event_mutate` from
   `authenticated`, then deploy the prior application/Edge version.
2. Preserve/export `authorization_events` and Authorization notifications.
3. Drop the guarded RPCs and helper only after application rollback is verified.
4. Keep the added columns by default. Dropping them loses send, decision,
   idempotency, and timeline history and requires explicit incident approval.
5. Restore the prior RLS policies only if their broader tenant visibility is
   explicitly accepted. Do not restore direct authenticated DML grants.

Staging dry run should record the preflight NOTICE counts, migration duration,
lock waits, skipped ambiguous names, and post-migration policy/privilege checks.
