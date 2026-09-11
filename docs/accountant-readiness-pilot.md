# Accountant readiness pilot

The first release adds two versioned practical tasks to the authenticated Talent portal, under **جاهزيتي للوظيفة / My job readiness**. Direct entry: `/?talent=1&talent_section=readiness`.

Candidates can complete invoice review and bank reconciliation, save drafts, submit once per task version, inspect structured-answer evidence, and request human review. Arabic and English are supported, including Arabic numeric input. Draft changes stay mounted while switching Talent tabs, with explicit save and an unsaved-page-exit warning. Submitted answers cannot be edited.

The existing junior accountant interview is linked from the readiness card and remains separately assessed. Excel and other unmeasured skills are explicitly marked as unassessed. An 80/100 task threshold plus a confirmed explanation review meets the **task** standard; it is not an overall professional certification or employment decision. This pilot threshold is a configured starting point, not a validated prediction of job performance.

## Review workflow

An active platform owner opens **Global Engineering Templates → مراجعة جاهزية المحاسب المبتدئ**. The queue includes submitted tasks, the original fictional task, candidate answers, server-side answer key, review guide and prior feedback. The reviewer records an evidence-based explanation outcome and feedback. The objective score and original answers are preserved; review events are append-only through the application RPCs. Requests for review return the status to Pending. Queue pagination is 20 items per page.

## Privacy and storage

Three RLS-enabled tables have no direct anon/authenticated grants. Narrow SECURITY DEFINER RPCs derive the candidate from `auth.uid()` and authorize reviewers through the existing active platform owner record, without company membership. Server-only answer keys are never returned to candidate RPCs or imported by production browser code. First save/submission requires explicit consent to storing and platform review. Results are private to the candidate and platform owner; no employer-sharing endpoint is included.

Save and review use revision checks. A repeated identical submission is idempotent. Submission and scoring occur atomically on the server. No uploaded real documents, AI scoring of narratives, training content library, alternative retake versions or employer matching are included in this first release.

## Verification

- Executable PostgreSQL tests apply the migration twice; enforce isolation, grants, consent, numeric validation, correct and partial scoring, stale revisions, locked answers, idempotency, owner-only review and review audit events.
- Browser checks use an isolated local fixture for Arabic input, saving, final submission, locked controls, pending versus confirmed outcomes, and reviewer workflow. The fixture is excluded from production deployment.
- Root and production-source Vite builds; existing Talent campaign and accountant tests.

## Next pilot steps

Have an accounting subject-matter reviewer assess wording, answer keys and review rubric. Trial with a small voluntary cohort, measure completion and reviewer agreement, and revise using a new task version when assessment content changes. Add equivalent retake tasks and employer-specific sharing only after testing and specifying consent and access rules.
