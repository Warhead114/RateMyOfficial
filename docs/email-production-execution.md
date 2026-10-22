# Production email execution and bounded acceptance

## Current evidence and limits

The operator reported a republish of candidate
4117cec6b23d34639d7cbe3539fc6da7870bec41. Read-only Production checks found an
active successful Autoscale deployment, HTTP 200 at the homepage and /api/health,
all nine approved schema changes, and an empty managed schema diff. Counts matched
18 officials, 42 teams, 20 approved coaches, zero events/reviews, and five historical
outbox rows (four sent, one cancelled); the latest send remained September 2.
These checks are not repeated by this preparation.

The active backend Git SHA is not exposed. The operator confirms the independent
Production key is in Publishing Secrets; only the Development parser was directly
validated. Agent secret inventory is not published-process proof. Effective web
mode/worker flags, Postmark sender verification and external job inventory remain
operator/runtime checks. Previously confirmed controlled/unset flags are accepted,
not changed or requested again without evidence of a change.

No new Production fixtures, sends, cleanup, key changes, scheduled jobs or live
activation have occurred. The launcher below has only local synthetic validation.

## One practical execution path

The prepared GitHub-specific implementation and single operator setup checklist
are in `docs/email-github-actions.md`. The bounded business scope is approved, but
execution remains held until the trusted environment is configured and the
operator releases the current instruction not to execute. GitHub repository
settings, required-reviewer entitlement and environment secrets remain unconfigured
and unverified; local source files alone do not establish a protected runner.

Primary Replit documentation supports external Production PostgreSQL clients.
It does not establish a one-shot shell/command facility on the existing Autoscale
deployment. A Workflows "Run" action is Development, not a Production console.
Do not replace Autoscale or configure a recurring job just to run validation.

Use one separately approved, operator-controlled trusted Linux host (or protected
CI environment for manual one-shot validation). No public service is needed.
The operator must establish this environment; Agent has no connection to it.
Do not put Production credentials in Development or send them through chat.

1. On that host, check out the exact runner/documentation commit from the report.
   Before injecting any Production secrets, run `npm ci` and `npm run build`.
   The reviewed application/CLI sources must match the audited source-tree digest
   pinned in the launcher (server, shared, CLI entrypoint and package manifests).
   This public snapshot intentionally omits private Replit ancestry; it does not
   require the historical Replit commit object to exist in the public clone.
2. Use the host's protected secret mechanism to inject the existing authorized
   Production connection and key, POSTMARK_SERVER_TOKEN, EMAIL_FROM, EMAIL_REPLY_TO,
   POSTMARK_MESSAGE_STREAM and APP_URL. Do not create, rotate or overwrite keys.
   Keep web DATABASE_URL and all web deployment settings unchanged.
3. The external connection must come from Database > Production > Settings, target
   neondb, and include sslmode=require or verify-full. If the provided connection
   cannot meet TLS checks, stop; do not edit the deployed DATABASE_URL or fall back
   to plaintext. Supply EMAIL_RUNNER_EXPECTED_DB_HOST from that approved connection.
4. Set these **runner-only** nonsecret gates after execution-environment approval:

   ```
   NODE_ENV=production
   SKIP_DATABASE_INITIALIZATION=1
   EMAIL_PRODUCTION_RUNNER_APPROVED=1
   EMAIL_RUNNER_APPROVED_REVISION=<exact checked-out runner commit>
   EMAIL_DELIVERY_MODE=controlled
   EMAIL_VALIDATION_ENABLED=1
   EMAIL_WORKER_ENABLED=0
   ```

5. With shell tracing and CI command debugging disabled, run
   `node scripts/email-production-runner.mjs preflight`. This checks the actual
   database name and negotiated TLS with one SELECT, and reports only booleans.
   It validates the runner key format, NOT the published web process. It does not
   contact Postmark, verify a sender at the provider, or prove inbox delivery.
6. Use `umask 077` and a private .email-validation directory. Invoke existing
   commands through the launcher, for example:

   ```
   node scripts/email-production-runner.mjs plan-fixtures .email-validation/input.json
   node scripts/email-production-runner.mjs apply .email-validation/fixture-plan.json fixtures:<reviewed-hash>
   node scripts/email-production-runner.mjs inspect <owned-run-uuid>
   ```

   Only the plan object, not its surrounding output, goes into each plan file.
   Keep all files mode 0600; do not upload raw plans, payloads or logs publicly.
   The launcher rejects Development, live mode, worker enablement, dirty/mismatched
   sources, unprotected input files, wrong targets and missing runtime gates.
   It runs one CLI command with a two-minute hard limit; no automatic retry,
   recurrence, queue drain, migration or application startup is added.

The original operation/hash acknowledgements remain mandatory. One concrete
business-scope approval can cover the batch, but cannot turn future unknown hashes
into approved manifests. The authorized operator reviews fresh exact plans locally
within that scope and supplies their matching hashes. This avoids repeated chat
approvals per test without removing the CLI's independent safety gates. Plans expire
after 15 minutes; real calendar-day reminders require fresh due-row manifests.

## Approved single bounded validation scope — execution held

Required inputs: four distinct deliverable addresses, mapped to primary disposable
coach, alternate coach, disposable supervisor, and an existing verified Admin.
The first three must not belong to existing accounts. Aliases may share a mailbox.
Never send to another administrator copy; capture it for cancellation/history only.
Existing Admin is an explicitly approved recipient/operator, NOT a test fixture.

The operator confirms ownership of the existing verified Admin. Retrieve its exact
ID/email privately through the authorized Production SELECT when preparing a
manifest; do not request the address again, print it, create a replacement Admin,
or change permissions. Ownership confirmation alone does not authorize sends.

### Three aliases, not three additional mailboxes

The CLI requires four distinct normalized address strings, not four independent
mailboxes. Normalization trims/lowercases; it does not collapse aliases. The fixture
schema still rejects duplicates/wildcards, checks the real verified Admin, and
refuses disposable addresses already registered in Production. A focused pure
contract check accepted distinct aliases and rejected a duplicate without any
database/provider calls. Do not change those checks.

The operator has now supplied three owned Gmail plus-address aliases. On
2026-10-22 a Production SELECT found zero existing users for each supplied alias,
including case/outer-whitespace variants. The actual aliases passed the fixture
contract unchanged; plus tags are preserved as three distinct identities. The
existing operator-owned Admin still has role admin and is_verified=true. Exact
addresses/IDs are private proposal inputs, not committed in this document.

The primary alias is a fixture user with role user, userType Coach and verified
status; the supervisor alias is a second fixture user with role user, userType
Regional Supervisor and verified status. The alternate alias replaces the same
coach's email later; it does not require a third fixture account. The existing
Admin is never modified. Fixture application must recheck collisions/Admin status
on the primary database; this read-only eligibility snapshot does not reserve names.

Google documents plus-address variations routing to the same inbox. No new mailbox,
provider alias subscription or provider setup is required for these supplied
Gmail addresses. Actual inbox delivery remains untested until explicit send approval.
Source: https://support.google.com/a/users/answer/9308648?hl=en

### Reduced fixture and send scope

One ledger-owned run creates two disposable users, one team, one official, two
events, event/team/official links and one notification identity, in a unique
EMAIL-VALIDATION:<UUID> region. Approve temporary public fixture visibility.
Normal authenticated workflows add one fixture review and one reset token.
No existing team, official, coach or administrator is edited, reassigned or deleted.
Any additional fixture record/token/request requires scope review, not silent retry.
Normal password-reset requests/attempts also update the application's hashed abuse
limiter buckets. Those operational counters are not disposable fixture records;
do not delete or reset them, including any shared IP bucket.

| Intended real messages | Count |
| --- | ---: |
| Initial assignment notice for event B; leave A's initial notice unsent | 1 |
| Coach password-reset message, consumed once and reuse rejected | 1 |
| Evaluation confirmation, approved Admin copy, fixture supervisor copy | 3 |
| One event-update notice | 1 |
| One alternate-address reapproval assignment notice | 1 |
| Unevaluated event's actual day-of and day-after reminders | 2 |
| Intended deliveries | 9 |

Approved total ceiling: **10 provider attempts across the entire run**, including
failed/ambiguous attempts. The spare attempt is not permission to resend an accepted
message. Keep a serialized cumulative attempt register from durable authorizations;
each send manifest selects at most ten exact due rows. Stop at the run ceiling.
For the original external launcher, operator review enforces the entire-run
ceiling. The GitHub adapter additionally checks prior durable max_attempts
reservations under an advisory lock and refuses reservations exceeding ten.
It conservatively does not reclaim unused/ambiguous reservations. Neither method
removes the exact-row/per-manifest limits or authorizes automatic retries.

Use evaluation event A on the actual New York creation day D0, and event B on D1,
the next New York day. Evaluate A on D0; send the one B update on D0. At 08:00 D1
verify A's day-after suppression and B's day-of notice BEFORE changing the coach
identity. A's reminder may already be cancelled; otherwise use its exact due-row
eligibility path and require cancellation with zero provider calls, not a delivery.
Only after that checkpoint, change the coach to the approved alternate address,
verify paused notification identity/cancelled future notices, and deliberately
reapprove it. Send only B's selected reapproval assignment. At 08:00 D2 verify B's
day-after reminder at the alternate address. B remains unevaluated.

Allow two subsequent calendar days, within the seven-day fixture lifetime. Run
manual exact-row invocations at real due times; do not activate a recurring test
scheduler or change clocks/due timestamps. Capture old/new rows and send only the
selected notices. If reapproval queues any additional notices, capture/cancel
them during cleanup rather than sending them. A missed checkpoint requires
review, not silent rescheduling/new fixtures. No implicit region approval or
legacy-coach backfill is permitted.

Check canonical links, sender, Reply-To, stream, HTML/plaintext, event times,
recipient routing and actual inbox contents. Consume one reset link and reject its
reuse. Token expiry retains automated-test evidence; do not request another reset
or send an additional expiry-test email merely to repeat that internal edge case.
Web issuance plus successful runner decryption tests matching keys end-to-end;
runner preflight alone does not. Never put raw reset links/tokens in plans or chat.
Use authenticated operator actions only on the owned IDs; no auth bypass.

Registration/approval/rejection retain prior real-delivery evidence and existing
automated regressions; this scoped CLI deliberately does not allow those templates.
Do not repeat them without a new failure. Retry/backoff, stale-claim fencing,
duplicate enqueueing, deleted-event cancellation and adversarial cases retain
Development evidence. Exercise natural Production failures only; no intentional
provider outage or forced stale timestamp. An ambiguous acceptance needs independent
provider review and the existing explicit exact recovery approval before any retry.

Stop the affected workflow on mismatch, rejection, unexpected routing, timeout or
ambiguous acceptance. Preserve the original journal; never recreate it to reset a
budget. Do not equate Postmark acceptance with inbox delivery. Operator inbox
inspection remains necessary unless separately approved mailbox access is provided.

## Exact cleanup covered only by an approved scope

After capturing every owned review/token/outbox ID, review the fresh cleanup plan
and its exact hash. It removes only this run's disposable accounts/sessions, team,
official, events/links, review and tokens; cancels only its unsent mail and clears
sensitive ciphertext. Keep historical and test outbox rows plus authorization and
fixture journals. Outbox totals will legitimately exceed five afterward. Verify no
test account/session or deliverable test backlog remains; compare fresh nonfixture
counts/fingerprints and preserve legitimate concurrent business changes. Never
delete shared limiter buckets or restore an old business snapshot.

## Live operations proposal — preparation, not activation

After controlled acceptance and a separate live approval, reuse the trusted Linux
host for one supervised job, leaving the public Autoscale app unchanged. A CI-only
one-shot runner is not automatically a reliable every-minute scheduler. If no
suitable host exists, hosting/cost selection is a genuine remaining dependency.

Proposed cron: `* * * * *`, scheduler timezone UTC. Durable queue timestamps already
encode 08:00 New York with DST; do not add a second daily reminder producer.
Build/install before injecting secrets. Production-only worker environment:
NODE_ENV=production, SKIP_DATABASE_INITIALIZATION=1, EMAIL_DELIVERY_MODE=live,
EMAIL_WORKER_ENABLED=1, EMAIL_VALIDATION_ENABLED unset. Preserve the same Production
key, approved connection, sender/Reply-To/stream and canonical APP_URL.

Proposed command on that host, with a host-writable protected lock:

```
flock -n -E 75 /run/lock/ratemyofficial-email.lock timeout --signal=TERM --kill-after=10s 240s npm run email:batch -- --once
```

Default batch size is 25. Jobs must not overlap; record skipped invocations and
alert on repeated skips. Review observed runtime before enabling the proposed
four-minute timeout. A timeout can leave ambiguous provider acceptance. Default
maximum attempts remain five, with a five-minute stale lease. Retry delays are
30 seconds, two minutes, ten minutes, one hour, then capped at six hours where
an existing row's attempt allowance permits; expiry can cancel sooner. Do not
reset or expand limits.

Before enabling, freshly inventory pending/retry/processing backlog by type and
age, including business changes during validation. The five original terminal
rows are not eligible, but future backlog cannot be assumed empty. Review all
initial recipients and obtain an explicit initial-batch limit. Do not blanket
approve legacy identities; 20 approved accounts is not proof of event-email
eligibility. Recipient populations follow existing account-status, verified
evaluation-role/region and explicitly approved coach/team rules.

The activation request must name the job owner and an independent failure-alert
destination. Configure alerts for command failures/timeouts, failed outbox rows,
claims older than five minutes, unexpired backlog overdue five minutes, repeated
overlap skips, and no successful job in five minutes. Run email:status read-only
after batches and inspect per-row outcomes; exit zero is not a delivery guarantee.
An alert channel dependent on this same email queue is insufficient.

Emergency stop: disable the host job first, disable worker enablement and set
delivery off through the separately authorized configuration flow; verify effective
runtime settings and republish/restart only if required and approved. In-flight
requests cannot be recalled. Inspect durable queue/provider state before resuming;
at-least-once delivery can duplicate an ambiguously accepted message.

Expected incremental hosting cost is zero only if an already funded host has
capacity. A new host/CI plan has no verified quote until selected. Existing database
and Postmark usage still apply. For comparison only, current Replit documentation
lists Scheduled deployments at $2/month plus $0.60/million compute units; using one
would require a separately approved deployment, not replacing this Autoscale app.
No new hosting, job, alert service or charge has been configured.

References:
- https://docs.replit.com/features/publishing/deployment-types
- https://docs.replit.com/features/data-and-storage/connection-details
- https://docs.replit.com/billing/deployment-pricing

Operator-tool checks: `node --check scripts/email-production-runner.mjs` and
`node --test tests/email-production-runner.test.mjs`. These use synthetic values
and do not contact Production/Postmark; they are not real-inbox acceptance.

## Remaining operator input and local command sequence

Recipient eligibility preparation is complete. Only an approved external
host/manual-CI environment and explicit bounded-batch authorization remain. Do not
request the supplied aliases or known Admin address again, or continue
investigating other hosting alternatives.
The operator injects credentials using that host's protected mechanism, never
the Development Secrets form. No external runner is connected or provisioned here.

After consolidated scope approval, use the setup/preflight steps above. Existing
commands for each reviewed phase are:

```
node scripts/email-production-runner.mjs plan-capture .email-validation/capture-input.json
node scripts/email-production-runner.mjs apply .email-validation/capture-plan.json capture:<reviewed-hash>
node scripts/email-production-runner.mjs plan-send .email-validation/send-input.json
node scripts/email-production-runner.mjs apply .email-validation/send-plan.json send:<reviewed-hash>
node scripts/email-production-runner.mjs plan-cleanup .email-validation/cleanup-input.json
node scripts/email-production-runner.mjs apply .email-validation/cleanup-plan.json cleanup:<reviewed-hash>
```

Apply only the reviewed exact plans/hashes, within their lifetime and the entire
run's ten-attempt ceiling. Inputs use the JSON contracts in email-scoped-validation.md.
Repeat planning only when the next selected rows are actually due; never replay
completed authorizations. Actual inbox inspection is operator-provided unless
separately authorized mailbox access is available. No additional infrastructure
has been created; existing host capacity may avoid incremental hosting charges,
but new host/CI costs and provider usage require operator review.
