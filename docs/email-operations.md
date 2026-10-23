# Transactional email workflows and validation

## Delivery safety

Nothing in application startup starts a delivery worker or reminder scheduler.
This change does not enable delivery, alter the controlled policy, or call Postmark.
Unit providers and lifecycle providers are injected in-memory fakes.

For the disabled-by-default fixture-owned transactional validation CLI, see
[Scoped email validation procedure](email-scoped-validation.md). It requires
separate operator approval and does not broaden the ordinary controlled-test path.

The existing controlled policy permits only an allowlisted `controlled_delivery_test`
row through the existing exact-row command. It does **not** permit broad queue
draining or ordinary transactional templates. Do not use `live` as a workaround
for a controlled validation. Testing actual transactional rows requires separate
operator authorization and appropriately scoped tooling; this change adds no bypass.

## Workflow inventory

| Action | Transactional work | Recipients / deduplication |
|---|---|---|
| Registration | User and `registration_received` outbox row | Registered address; existing user-based key |
| Approval | Approval, pending-rating activation and `account_approved` | Account address; existing user-based key |
| Rejection | Cancellation of unsent registration, rejection message and deletion | Account address; existing user-based key |
| Evaluation | Review, approved-only aggregates and confirmations | Submitting coach plus verified admins and verified supervisors in the event's trusted region; review/recipient keys |
| Forgot password | Revoke earlier links, cancel old queued messages, hashed token and encrypted reset message | Account address only; reset-request key |
| Event assignment / update | Event, assignments, version and notifications | Verified coaches with exact school/team-name match and matching trusted team/event region; explicit conflicting coach regions are excluded |
| Event reminders | Outbox rows scheduled at assignment time | Same coaches; event version, coach and reminder kind key |

Admin/supervisor notifications contain names and event context, **not evaluation
comments or numerical ratings**. No client-supplied email destination is used.
An account-approval transaction records the coach's approved team ID and email
in coach_notification_identities. Dispatch requires this snapshot and the current
profile to agree. Self-service email/school/region changes invalidate it; changing
back does not restore trust. An authorized managed-coach save reapproves the
details only for an approved account. The coach-management screen shows whether
event emails are approved or paused. No existing accounts are silently backfilled:
managers confirm legacy approved coaches using that screen before event delivery.
Approval/reapproval reconciles upcoming assigned events and recreates future
reminders at the approved address, without changing sent history or replaying missed
reminder times. Each approved identity has a durable key in reminder deduplication;
identical manager saves preserve that identity and do not resend messages.
Missing coach regions are derived from the associated trusted team; null-region
teams/events and explicitly mismatched coach regions require administrator correction.
Exact school matching preserves the app's
existing team association rather than inventing a new membership model.

## Dates, reminders and changes

All event calendar dates and wall-clock start times use America/New_York.
Dates stored at UTC midnight are treated as date-only fields, not shifted back
one day for display. Start times are displayed with EST/EDT. Missing times are
explicitly described as unspecified.

The chosen default for the user's day-of/day-after schedule is **8:00 a.m.
New York time**, calculated separately for each calendar day to handle DST.
Day-of reminders expire at the end of that day. Day-after reminders expire at
the end of the following day and are cancelled if the coach has submitted
**any evaluation for that event**, including an evaluation awaiting approval.
The day-of reminder is unconditional. Missed reminder times are not backfilled
when an event is newly assigned; an immediate assignment email is still queued.

Effective event changes create a new durable notification version. Identical
updates do not create duplicate messages. Old unsent reminders/assignments are
cancelled; sent history is retained. Deleted events cancel queued notices.
The worker rechecks current event version, school/team relationship, verification,
region, recipient address and day-after evaluation eligibility before dispatch.
Updates accepted after a provider call is already in flight cannot recall mail.

## Password reset

Tokens use 32 cryptographically random bytes; only SHA-256 hashes are stored.
Links expire in 30 minutes, are single-use and revoked when replaced. Passwords
are bcrypt-hashed. Successful reset increments the account's session version.
Only the configured APP_URL is used for links; the outbox link payload is encrypted.

PostgreSQL atomic buckets replace process-local request limits: five forgot
requests per IP and three per normalized address per 15 minutes; twenty reset
attempts per IP per 15 minutes. No raw IP/address is stored in the limiter.
Forgot responses remain generic and have a minimum response duration. Database
failures fail closed. Expired limiter rows have bounded opportunistic cleanup.
Token issuance and consumption lock users before tokens to avoid inverse-order
deadlocks across instances.

## Worker reliability and monitoring

Claims use `FOR UPDATE SKIP LOCKED`, leases and claim tokens. Finalization requires
the current token. Stale claims recover with bounded attempts; retries use the
existing backoff. Future reminders remain durable in PostgreSQL across restarts.
Eligibility lookup failures retry without sending; revoked eligibility cancels.
Invalid templates fail without contacting a provider. Missing provider configuration
blocks the batch before claiming rows.
The worker checks its claim fence again immediately before provider invocation.
A cancellation committed before that final authorization prevents dispatch.
After that authorization the operation is in-flight: concurrent event changes
cannot atomically recall an external provider request.

This is **at-least-once delivery**, not a promise of provider-level exactly-once.
Local deduplication prevents duplicate enqueueing and normal concurrent dispatch,
but a crash after Postmark accepts a message and before database finalization
can lead to a repeated delivery after lease recovery. Postmark metadata is not
a provider idempotency guarantee. Operators must account for this limitation.

`npm run email:status` reports status/type counts, due backlog and stale claims
without payloads or addresses. Alert on failed rows, growing overdue backlog
and stale claims. Review provider metadata separately under operator access.

`npm run email:batch -- --once` is a future one-batch operator entrypoint. It
requires **both** EMAIL_WORKER_ENABLED=1 and explicit live delivery policy,
otherwise it refuses to claim/send. It is never invoked by app startup, build,
or tests. No operational scheduler has been enabled. A future approved scheduler
must invoke bounded batches with suitable cadence, timeout and monitoring.

## Deployment prerequisites and real-delivery validation still required

1. Review the nine additive statements: events.notification_version,
   password_reset_rate_limits and its expiry index, coach_notification_identities,
   email_validation_fixtures, email_validation_authorizations and three foreign keys.
   Apply through the supported operator Publish flow,
   never a startup DDL hook or Development-data overwrite.
2. Verify APP_URL, encryption key, Postmark sender/Reply-To, stream and controlled
   allowlist via secure settings. Preserve the existing key for queued reset links.
3. Preserve controlled mode. Before enabling any operational worker, obtain
   separate authorization and define backlog review, monitoring and ambiguous-send
   handling. Do not assume a mocked test proves inbox delivery.
4. Under separately approved exact-row tooling, validate evaluation confirmation
   and admin/regional-supervisor copies; password reset inbox/link/single-use/session
   invalidation; coach assignment; day-of reminder; day-after reminder and suppression.
   Use disposable records and approved recipients; verify HTML/plaintext,
   timestamps/EST-EDT, provider IDs and exactly the intended outbox rows.
5. Previously verified registration, approval, rejection and controlled test
   behavior is preserved; revalidate only if deployment reveals a regression.

## Safe Development database tests

Before running integration tests, inspect the platform's explicit Development
database identity and compare it to a SELECT-only query through the shell connection.
Run with TEST_DEVELOPMENT_DATABASE set to that verified name (currently heliumdb),
for example `TEST_DEVELOPMENT_DATABASE=heliumdb npm run test:db`.
Every database suite refuses to write if the expected identity is absent or
mismatched, NODE_ENV is production, or startup DDL suppression is missing.
The fixture worker uses exact disposable IDs and never drains or recovers the
historical queue under simulated time. Cleanup targets generated IDs/markers only.

## Final operational acceptance — prepared, not activated

The queue itself schedules reminders durably; do not add a second reminder
producer or per-web-instance timer. After controlled real-inbox acceptance and
separate live-activation approval, one supervised job should run bounded
25-message batches at least once per minute, with overlap prevention and a
timeout. The ordinary batch command requires both `EMAIL_WORKER_ENABLED=1`
and `EMAIL_DELIVERY_MODE=live`; neither is authorized by this document.

Before activation, name an operator and escalation recipient and configure:
- Immediate alerts for nonzero failed-message counts or job failures.
- Alerts for processing claims older than five minutes.
- An overdue unexpired-queue alert (proposed initial threshold: five minutes).
- A missed-job/last-success alert (proposed initial threshold: five minutes).
- Provider acceptance/rejection and delivery-event review under approved access.

Thresholds are proposed operational settings, not an implemented alert service.
Replit job-failure alerts alone do not replace queue-status monitoring: a batch
may exit successfully while individual messages fail. Inspect `email:status`
output and per-row outcomes without exporting recipients or payloads.

Keep normal expiry, attempt limits and retry backoff. Inspect provider acceptance
before retrying an interrupted send: database fencing cannot undo an already
accepted provider call. Scoped validation recovery permits only exact captured
stale validation claims and sends nothing; a retry requires a fresh authorization.
Never bulk-reset failed rows or replay completed send approvals.

Pause by stopping the supervised job first, disabling worker enablement, then
setting delivery off through the authorized deployment configuration flow.
Republish/restart as required and verify the effective runtime gates. Requests
already in flight cannot be recalled. After a deployment restart, inspect the
durable queue and claims; do not recreate reminders or reset authorization
journals. Resume the same job only after operator approval.

No recurring job, operational alert service, unrestricted live mode or Production
worker was configured or activated in this completion pass.
