# Scoped email validation: operator procedure

## Boundary

This tooling is disabled by default. No Production writes, migrations, Postmark
calls, real email or scheduler activation were performed during implementation.
The original controlled-test policy remains unchanged. Never use live mode as a
transactional validation workaround.

Use `npm run email:validation -- <command> ...` in Development. The build also
creates `dist/email-validation.js`, outside public assets, for a separately
approved privileged operator job. It is not imported by startup, exposed through
HTTP, automatically scheduled or executed during deployment.

Every mutation requires privileged runtime access, an explicit operation/hash
approval, EMAIL_VALIDATION_ENABLED=1, EMAIL_DELIVERY_MODE=controlled,
EMAIL_WORKER_ENABLED not equal to 1, and SKIP_DATABASE_INITIALIZATION=1.
These are prerequisites, not settings changed by this implementation.

Verify Postmark credentials, verified sender, explicit Reply-To, stream,
encryption key and trusted APP_URL securely before any real delivery. Do not
copy credentials, reset tokens, session cookies or email bodies into manifests.
Publishing-only settings must be checked by an authorized operator.

## Fixture creation: dry run, then independent approval

Keep operator files mode 0600 in `.email-validation/`, excluded from Git and
deployment. Input for `plan-fixtures <input.json>`:

```json
{
  "runId": "<new UUID>",
  "coachEmail": "<approved disposable coach inbox>",
  "alternateCoachEmail": "<approved alternate coach inbox>",
  "supervisorEmail": "<approved disposable supervisor inbox>",
  "adminUserId": 123,
  "adminEmail": "<exact existing approved administrator inbox>",
  "evaluationDay": "<today in America/New_York: YYYY-MM-DD>",
  "reminderDay": "<future New York calendar day: YYYY-MM-DD>",
  "expectedProtectedOfficials": 18
}
```

123 is an example, not a target ID. The tool verifies the actual administrator's
ID, email, role and approval, without editing that account. The three disposable
addresses must not already belong to accounts.

Planning performs SELECTs only. The output contains `plan` and
`requiredAuthorization`. Review it, copy only the plan object into a protected
file, obtain explicit authorization for these writes, then run:
`apply <plan.json> fixtures:<exact printed hash>`.

Creation is transactional: one team, explicitly approved disposable coach,
supervisor, official and two assigned events, in a unique
EMAIL-VALIDATION:<run UUID> region. Random account passwords are not printed.
All IDs and protected official fingerprints are recorded atomically in a durable
ledger. Default expected Production inventory is 18. Existing business records
are never reassigned or approved. Obtain approval for temporary public fixture
visibility and global-count effects before creation.

## Exercise existing workflows and capture exact IDs

Use the normal authenticated application/API to submit the fixture evaluation,
request/reset only the fixture coach's password, reapprove its alternate email,
and reschedule/delete only fixture events. Do not rebuild these workflows.

`inspect <run UUID>` prints candidate review, token and outbox IDs/statuses,
never tokens or message payloads. Capture exact reviewed IDs using
`plan-capture <input.json>`:
```json
{
  "runId": "<UUID>",
  "requested": { "reviewIds": [], "tokenIds": [], "outboxIds": [] }
}
```
Review/apply its separate `capture:<hash>` approval. Reviews must match the owned
coach/official/event; tokens must belong to the owned coach. Reviewer mail must
match an approved administrator or the owned supervisor, the captured review and
fixture event link/context. Confirmation mail must address the owned coach.

Capture again after resets, reapproval and rescheduling. Inspect all generated
admin copies: capture valid fixture copies for cancellation/history even when
their addresses are not approved for delivery. Never select such copies to send.

## Exact transactional delivery

`plan-send <input.json>` accepts:
```json
{
  "fixtureRunId": "<UUID>",
  "rowIds": [123],
  "recipients": ["<exact approved fixture/admin inbox>"],
  "permittedTypes": ["event_created"],
  "approvedBy": "<operator approval reference>"
}
```
Use actual captured IDs. Only evaluation_submitted, password_reset, event_created
and event_reminder are permitted. Selected rows must be due and unexpired.
Recipient addresses must belong to this fixture's explicitly approved inbox set.

Review the plan, obtain send approval, then:
`apply <plan.json> send:<exact printed hash>`.
The approval reference is an audit label, not an authentication credential.

Each authorization lasts at most 15 minutes and allows 1–10 unique exact rows.
The manifest binds IDs, types, addresses, immutable row hashes and full rendered
message hashes. No wildcards. The provider gate rechecks claim ownership, hash,
type/address, durable budget and final claim fencing immediately before sending.
Failed/ambiguous attempts consume budget too. The same authorization cannot be
replayed after completion or a crash. One unexpired invocation per run is allowed.
No broad claim, expiry or stale-recovery operation is called by this facility.

Inspect result counts and exact row statuses; verify provider IDs and HTML/plain
text in the approved inbox. An exit code alone does not prove delivery.

Wait for the real 8 a.m. America/New_York reminder schedule. Allow two days to
observe both reminders. Use the second event without an evaluation to observe
both reminders, and the evaluated event to prove next-day suppression. Never
override the Production clock or edit due timestamps to accelerate validation.
Only Development tests use fake providers and simulated time.

## Retry, interruption and ambiguous acceptance

Retry_wait rows retain normal expiry, attempt limits and backoff. After due time,
obtain a fresh exact send plan/approval. Do not replay old authorization, bulk-reset
failed rows, resend sent mail or drain unrelated backlog.

After interruption, pause new operator invocations. Inspect durable authorization
and claim state, then provider acceptance. A request may have been accepted even
if the row was not marked sent. Delivery is at-least-once, not exactly-once.

`plan-recover` accepts `{ "runId": "<UUID>", "rowId": 123 }`. It permits only a
captured validation-owned claim stale for at least five minutes. Explicitly review
possible duplicate acceptance before separately approving `recover:<hash>`.
Recovery sends nothing, clears only that exact fenced claim and consumes an
attempt. Depending on expiry/limits it becomes retry_wait, failed or cancelled.
Retry still needs a new authorization. An old running invocation must finish or
its 15-minute authorization must expire before another send run.

Journals survive restarts: inspect the original run, do not recreate fixtures or
reset budgets. Fixture send eligibility expires after seven days; cleanup remains
available. Never use this recovery command for ordinary business claims.

## Independent exact cleanup

Stop validation invocations, resolve in-flight claims, inspect/capture every
related ID, then use `plan-cleanup` with `{ "runId": "<UUID>" }`.
Review its exact deletion/cancellation IDs, obtain separate cleanup approval and
run `apply <plan.json> cleanup:<hash>`.

Ownership comes from the database ledger, never substituted caller IDs. Unexpected
users, relationships, reviews, tokens or messages cause refusal. Owned roots are
locked and checks repeated before mutation. Only owned unsent messages are
cancelled, with sensitive ciphertext cleared. Sent/failed/cancelled outbox rows
and the cleaned ledger are retained as history.

Owned reviews are deleted by exact IDs; only the disposable official's aggregate
is recalculated via the ratings service before dependent fixture deletion.
Deleting fixture users invalidates their sessions without touching business
sessions or shared rate-limit buckets.

Every originally protected official ID must still exist. Cleanup planning takes
a fresh fingerprint of all nonfixture officials, incorporating legitimate
business changes since creation. That approved snapshot must agree before and
after cleanup. Concurrent business changes invalidate the plan: obtain a fresh
dry run and approval; never overwrite or roll back the business change.
The result reports the protected count (18 for the audited Production inventory).
The outbox grows by retained test history; it should not return to its old count.

## Scheduling/live delivery procedure — not enabled

After real-validation acceptance and separate live-delivery approval:
- Initially use one explicitly enabled supervised scheduler/job, not a timer in
  every Autoscale web instance. No scheduler was configured by this change.
- Run bounded batches at least once per minute, with overlap prevention and a
  runtime timeout. Review the ordinary batch size of 25 and provider throughput.
- Monitor failed messages, overdue unexpired backlog, five-minute stale claims,
  unexpected cancellations and abandoned authorization runs. `email:status` is
  read-only; automated alerts still require operator configuration.
- To pause: stop the scheduler, disable worker enablement and verify effective
  runtime state. Off mode blocks future sends, not requests already in flight.
- Preserve expiry/backoff/attempt limits. Investigate ambiguous provider acceptance
  before recovery or retry. Never bulk-clear failures.
- After restart inspect durable queue state, recheck backlog and resume the same
  supervised scheduler only with authorization; do not recreate reminders.

## Legacy coach approval: no automatic inference

The earlier audit found 20 approved coaches without trusted notification
identities, 42 null-region teams and coach ID 45 without an exact team match.
These findings are not permission to change those records.

An administrator must independently verify: coach identity/current approval,
canonical team affiliation, authoritative team region, coach region for regional
management, notification address ownership/consent, and currently assigned events.
Resolve missing/ambiguous school mappings before a deliberate approval save.
Reapproval can enqueue currently eligible assigned-event mail; inspect it first.

The Admin team and coach edit dialogs now have a separate **Save region** action.
Enter an authoritative label or explicitly choose an existing association
suggestion; no supervisor or school value preselects a region. Only administrators
can call the dedicated region endpoints. Saving a coach region invalidates an
old notification identity when the region changes; it does not approve the
account, team affiliation or event-email identity. Saving a team region does not
modify its coaches or approve any notification identity.

Assign the team region, explicitly assign the coach region, independently check
the canonical school/email and account approval, then deliberately save the
managed coach profile to approve its notification identity. The existing profile
save remains separate and can enqueue eligible event mail; inspect before delivery.
No implicit region, automatic WNCWOA assignment, blanket approval or bulk backfill
is performed. The operator has reported republishing the reviewed candidate;
deployment metadata does not independently expose the active backend Git SHA.

For the trusted-host launcher, one consolidated business-scope approval and
unchanged local exact-plan/hash gates, see
[Production execution and bounded acceptance](email-production-execution.md).

## Deployment prerequisites

Review the additive validation-journal migration with the existing email schema
migrations, using the supported managed Publish schema review, not startup DDL or
an operator Production migration script. Reconfirm inventory/configuration before
real fixture writes. Publish, fixture creation, delivery, ambiguous recovery,
cleanup and scheduler activation each require their own approval.
