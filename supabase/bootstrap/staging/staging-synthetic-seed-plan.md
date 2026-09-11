# Staging synthetic seed plan

This is a plan only. It does not contain executable SQL, credentials, real
email addresses, or Production data.

## Safety rules

- Use project ref `iijhdilfzndqlguefipn` only.
- Generate all names, phone numbers, identifiers, and email aliases solely for
  Staging.
- Do not use `agency.qa@visaflowksa.com` or any address belonging to a
  Production user.
- Do not copy UUIDs, Auth identities, agency records, company records, candidate
  records, or storage objects from Production.
- Use a dedicated test mail domain or inbox approved for Staging invitation
  delivery.
- Record creator, request id, and lifecycle events in the Staging audit path.

## Proposed fixture set

1. One synthetic company in a clearly non-production state, for example
   `VisaFlow Staging Test Company`.
2. One synthetic Platform Owner or Admin Auth identity, created through the
   approved administrative setup path.
3. One synthetic Recruitment Manager identity linked only to the synthetic
   company.
4. One brand-new synthetic agency with a unique Staging-only name and no
   Production identifiers.
5. One dedicated Staging invitation recipient address that has never been used
   in Production.

Do not put actual recipient addresses or passwords in this repository.

## Execution order after approval

1. Confirm the Staging project ref in both dashboard and CLI.
2. Confirm schema bootstrap, migration history, baseline, and provisioning
   migration verification are complete.
3. Configure and test the Staging Auth redirect allowlist and invite template.
4. Configure the provisioner origin allowlist and redirect secret.
5. Create the synthetic administrative identity through an approved, audited
   one-time process; require password setup and MFA if supported.
6. Create the synthetic company and link the administrative identity.
7. Create and link the Recruitment Manager with Draft-only agency capability.
8. Use the application workflow to create the new agency Draft.
9. Provision the agency using the approved Admin identity and the dedicated
   Staging invitation address.
10. Verify the lifecycle remains `Invitation Sent` until invitation acceptance
    and first successful login, then becomes `Active`.
11. Verify tenant isolation and audit events; do not inspect or export personal
    row values.

## Cleanup

Cleanup requires separate approval. Prefer suspending the synthetic identities
and agency over destructive deletion when lifecycle/audit testing must remain
reviewable. Never cascade-delete business tables or Auth users as part of an
automated test.
