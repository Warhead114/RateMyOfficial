# Email completion: guarded rollout handoff

## Current acceptance status

The operator has now republished and confirms independent keys installed in both
environments. Development parsing was validated. Read-only Production verification
found healthy HTTP endpoints, all nine changes applied, no remaining managed schema
diff, unchanged business counts and five original terminal outbox records. Exact
backend Git SHA and effective published key/mode/job state remain independently
unverified. No controlled inbox tests or live activation have been performed.

Use [Production execution and bounded acceptance](email-production-execution.md)
for the operator-only launcher, reduced ten-attempt scope and separate live
activation gate. The launcher/documentation commit is not a claim of a new web
deployment. Do not repeat completed migrations, full tests or integrity audits.

The bounded nine-message/ten-attempt scope is approved, but execution remains held.
The manual protected GitHub runner is prepared locally; its repository environment,
reviewers, entitlement and secrets require operator setup before any dispatch.
Use [GitHub setup checklist](email-github-actions.md). No GitHub run has occurred.

## Historical implementation boundary

Development implementation is complete, including separate Admin-only region
assignment. No Production publish, fixture write, real send, secret installation,
worker enablement, recurring job or operational alert service was performed.
Production inbox behavior is not yet verified for the newly completed workflows.

The operator has confirmed the 7-day Production recovery window, controlled
delivery, unset worker/validation flags, and presence of the existing database
and Postmark secrets. Do not request those confirmations again without evidence
of a change. Presence does not certify a sender's provider verification.

## Encryption configuration: operator-only

There is no Agent callback for securely installing a generated secret into the
Publishing deployment-secret scope. Do not generate operational keys without a
secure destination, use non-secret environment setters, or place values in
source, logs, shell history, approval files or chat.

The operator must use a trusted local cryptographic random generator to create
two independent 32-byte keys, preferably represented as 64 hexadecimal
characters. Store one as EMAIL_SENSITIVE_PAYLOAD_KEY in Development Project
Secrets and the other in Production Publishing Deployment Secrets. Never reuse
the Development value in Production. Keep a secure recovery copy and preserve
the Production value for future deployments.

The previous focused Production inspection found no encrypted outbox payloads
and no reset tokens requiring key recovery; do not repeat it absent a change.
Restart Development after adding its key. Verify presence/32-byte parsing with
a no-network, boolean-only runtime check; do not display the value. Publishing
secret changes take effect on republish, not by restarting the editor workflow.
Do not publish merely to activate a key.

## Deployment candidate

Use the exact reviewed commit from the completion report, not an assumed deployed
Git revision. Deployment metadata does not expose the active backend Git SHA.
The managed schema preview contains nine additive statements:

| Statement | Object |
|---|---|
| Create table | coach_notification_identities: approved user/team/email identity |
| Create table | password_reset_rate_limits: shared hashed limiter buckets |
| Create table | email_validation_fixtures: durable fixture ownership |
| Create table | email_validation_authorizations: unique manifest hash and durable attempt budget |
| Add column | events.notification_version, integer, default 0, not null |
| Add foreign key | coach_notification_identities.user_id → users.id, ON DELETE CASCADE |
| Add foreign key | coach_notification_identities.team_id → teams.id, ON DELETE CASCADE |
| Add foreign key | email_validation_authorizations.fixture_run_id → email_validation_fixtures.run_id, NO ACTION |
| Create index | password_reset_rate_limits_expiry_idx on expires_at |

There are no destructive operations or Development data transfers in this
preview. The operator must retain the existing Production database and leave
all Development-copy/overwrite options disabled in Publishing. Their current
UI selection cannot be certified by the Agent schema-preview callback.

Use only managed Publish. Public documentation confirms schema application as
part of publishing and possible temporary app stoppage; it does not expose a
strict traffic-cutover contract in the deployment metadata. Capture the schema
and application activation stages in the approved Publish result. Never add
startup migrations, run Production db:push, or substitute Development data.

Keep EMAIL_DELIVERY_MODE=controlled and worker/validation flags unset. App
startup, build and the scoped CLI do not start email scheduling. Existing
conditional session-table setup skips creation when public.session exists;
it is not an email migration hook.

Once keys and UI-only data-preservation controls are confirmed, obtain explicit
approval for the exact reviewed revision. The operator clicks Publish; approval
in chat alone is not a claim that publishing occurred.

## After an approved successful Publish

Read-only checks must establish public/API health, Production connectivity,
the four new tables, notification-version column, three foreign keys and index.
Compare the original business IDs/counts and five historical outbox records
(four sent, one cancelled); the baseline is 18 officials, 42 teams, 20 approved
coaches, no events and no reviews. Investigate discrepancies without editing data.
Confirm no unexpected active backlog or send, and effective controlled delivery,
disabled validation/worker and no scheduled email job. Verify the published
release/build record rather than using a frontend asset hash as backend proof.

## One-shot Production CLI execution

No currently available tool attaches a command shell to the Autoscale process.
The primary Scheduled-deployment documentation describes recurring cron
commands; do not assume a manual one-shot button or replace this web deployment.

One supported alternative is a separately approved **Production-only operator
runner on a trusted host/CI**, using Replit's supported TLS external Production
database connection. Inject the existing authorized Production connection and
required secrets through the runner's protected secret mechanism, never through
Development, source files or shell history. This does not change the web app's
DATABASE_URL. Build the reviewed revision before injecting Production secrets,
then execute the bundled dist/email-validation.js once with a timeout and no
recurrence. Do not use this runner as a workaround for installing Replit secrets.

The operator must separately authorize that privileged environment. For a
controlled validation invocation only, use SKIP_DATABASE_INITIALIZATION=1,
EMAIL_VALIDATION_ENABLED=1, EMAIL_DELIVERY_MODE=controlled and a disabled broad
worker. Web deployment flags remain unchanged. Every mutation still requires
its operation/hash approval. No such runner or connection was configured here.

Replit references:
- https://docs.replit.com/features/data-and-storage/connection-details
- https://docs.replit.com/features/publishing/deployment-types
- https://docs.replit.com/features/data-and-storage/development-and-production

## Short controlled-inbox sequence

Use email-scoped-validation.md for exact JSON contracts and CLI commands.
Approve four distinct deliverable addresses: disposable coach, alternate coach,
disposable supervisor and the existing verified Admin address. Aliases may share
a mailbox. Approve fixture visibility, dates, specific writes, specific sends
and cleanup independently; never send to another Admin copy without approval.

Create the isolated fixture run, capture exact IDs, then approve only selected
assignment, reset, evaluation-confirmation/Admin/regional messages. Use normal
app workflows. Leave the second event unevaluated to observe actual 8 a.m.
America/New_York day-of/day-after reminders; the evaluated event proves
suppression. Do not accelerate Production time. Afterward exercise rescheduling,
self-service pause, deliberate reapproval, deletion/cancellation and replay denial.
Do not repeat historical real registration/approval/rejection tests.

Only naturally occurring provider failures/interrupted validation claims justify
Production retry/recovery tests. Check provider acceptance first, respect
backoff/expiry and obtain fresh exact authorization. Development fake-provider
tests cover failures when no natural Production failure occurs.

Inspect/capture every related fixture record, independently approve exact cleanup,
cancel only unsent fixture mail, retain all outbox/journal history, and compare a
fresh protected-business baseline. Legitimate business changes during the
multiday test must not be overwritten or frozen.

Live scheduling and alert configuration remain a later separately authorized
step described in email-operations.md. Controlled validation is not unrestricted
live-delivery acceptance.
