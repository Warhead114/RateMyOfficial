# Protected manual GitHub runner for bounded Production email validation

## Status and boundary

The operator approved nine intended messages, at most ten provider attempts,
owned disposable fixtures and exact cleanup. Execution is still on hold.
Preparing/committing this workflow is NOT authorization to trigger it now.
No GitHub settings, secrets, Production records, sends or cleanup were changed.

Use `.github/workflows/production-email-validation.yml` and the GitHub-only adapter
`scripts/email-github-runner.mjs`. Neither is imported by the application.
No Replit republish, application change, migration, public endpoint, new hosting
or recurring schedule is needed. The existing scoped CLI remains unchanged.
The business workflow and nine-message selection remain in
`docs/email-production-execution.md`.

## Suitability and account prerequisite

Replit supports external Production PostgreSQL connections using the Production
connection string and TLS. The launcher requires the separately approved host,
`/neondb`, sslmode=require or verify-full, and a successful actual TLS check.
There is no Development connection or fallback in the workflow.

This workflow deliberately requires a PRIVATE repository, default branch,
GitHub-hosted ephemeral Linux runner and protected environment.
GitHub currently documents required environment reviewers for private repositories
as an Enterprise capability: Free/Pro/Team required reviewers are public-only.
This implementation targets GitHub.com / Enterprise Cloud, not Enterprise Server
(the pinned modern artifact action does not support Enterprise Server).
Do not make this application public, purchase an account upgrade or substitute an
unprotected environment to work around that prerequisite. If the existing account
cannot supply the required protection, stop and report that specific blocker.
An independent reviewer is necessary with Prevent self-review enabled.

Sources:
- https://docs.replit.com/features/data-and-storage/connection-details
- https://docs.replit.com/features/data-and-storage/development-and-production
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/actions/reference/security/secure-use

## One consolidated operator setup checklist

Do not paste credentials into chat or Development. This checklist is configuration
only: do not click Run workflow during preparation.

1. **Repository/access.** Use the authorized private RateMyOfficial repository.
   Push the prepared commit to its default branch through the normal reviewed
   process; this does not publish Replit. Confirm the default branch contains the
   audited application source tree and all new runner files. The public snapshot
   uses a pinned source-tree digest instead of private Replit commit ancestry.
   Repository administration and an account entitlement
   supporting private required reviewers must already be available.
2. **Branch protection.** Require review for changes to the default branch,
   especially `.github/workflows/`, operator scripts, package manifests and the
   validation implementation. Restrict who can write, dispatch and administer
   secrets. The environment must allow ONLY this default branch, not wildcard
   branches/tags. Do not accept untrusted pull-request code.
3. **Actual environment protection.** Create the exact environment
   `production-email-validation`. Add required trusted reviewer(s), enable
   Prevent self-review, disable administrator bypass, and configure the branch
   restriction above. Use a second authorized person to approve dispatched jobs.
   YAML references do not create these protection rules. Missing environments
   can otherwise be auto-created unprotected by GitHub.
4. **Environment variables, not repository-level substitutes:**

   | Name | Value |
   | --- | --- |
   | EMAIL_VALIDATION_ENVIRONMENT_READY | reviewers-required, only AFTER verifying the real rules above |
   | EMAIL_VALIDATION_ALLOWED_REF | refs/heads/ followed by the actual default branch |
   | EMAIL_RUNNER_APPROVED_REVISION | Full reviewed commit SHA that contains this workflow; obtain with git rev-parse HEAD after the final push/merge |
   | EMAIL_RUNNER_EXPECTED_DB_HOST | Exact hostname in the approved Production TLS connection |

   The readiness value is operator attestation, NOT an API verification of
   protection. A new source/merge commit requires fresh source review and updating
   the approved SHA; never set it automatically to whichever commit was dispatched.
5. **Environment secrets only**, using GitHub Settings > Environments >
   production-email-validation. Do not use repository/organization secrets or
   Development/Replit project secrets as substitutes:

   | Name | Existing Production value / purpose |
   | --- | --- |
   | RMO_PRODUCTION_DATABASE_URL | Production > Settings connection, /neondb, TLS required |
   | EMAIL_SENSITIVE_PAYLOAD_KEY | Existing independent Production key, unchanged |
   | POSTMARK_SERVER_TOKEN | Existing appropriate server token, NOT an account-wide token |
   | EMAIL_FROM | Verified sender |
   | EMAIL_REPLY_TO | Approved explicit Reply-To |
   | POSTMARK_MESSAGE_STREAM | Existing approved transactional stream |
   | EMAIL_VALIDATION_FIXTURE_JSON | One fixed private fixture scope described below |
   | EMAIL_VALIDATION_INPUT_JSON | Exact current input or reviewed plan; only needed for capture/send planning or apply |

   Prefer an existing least-privilege Production service credential. It needs
   the existing CLI's operational DML, including journals/sessions/outbox, and
   SELECT for pg_stat_ssl plus advisory locks; it does not need schema/role
   administration. Do not create roles/grants in this preparation. The application
   credential is not a row-level sandbox: approval, source trust and scope checks
   are essential. Never provide a Development database URL, SESSION_SECRET,
   mailbox password, GitHub personal access token or full Development environment.
6. **Fixed fixture JSON.** Use the supplied privately prepared configuration if
   available at `.email-validation/github-fixture-config.json` (ignored by Git and
   deployment), or construct it from the existing protected fixture contract in
   `docs/email-scoped-validation.md`. Use the already-approved three Gmail
   aliases and existing real verified Admin ID/email; do not request that address
   again, create an Admin or change permissions. Assign ONE UUID for this entire
   approved run. Set evaluationDay to the actual first-run New York date and
   reminderDay to its next calendar date. Initial expectedProtectedOfficials is
   18. Freeze this scope once fixtures are created. Never replace it to obtain
   a fresh send budget. Normal business changes require a fresh protected-baseline
   review, not resetting/deleting business records to force a count.
7. **Actions policy and report privacy.** Allow only the pinned official
   checkout/setup-node/upload-artifact actions used here. Leave shared caches and
   debug tracing disabled. Restrict artifact/log readers to trusted people.
   Reports contain owned addresses, IDs, plans/hashes and statuses, but not raw
   stdout/stderr, credentials, reset links or bodies. Retention is one day;
   securely download needed reports before expiry. No email credential is exposed
   during dependency installation/build; install scripts are disabled.
8. **Final setup confirmation.** Confirm protection/entitlement, source SHA,
   private secret placement and the fixed fixture scope. STOP without dispatching.
   The current assignment expressly prohibits workflow execution. After the
   operator releases that hold, the existing bounded business approval applies;
   no new application development or Replit republish should be necessary.

No GitHub administration or repository connection was configured by these files.
GitHub-hosted Linux minutes/storage consume the account's existing allowance and
may be billed according to that account. Check the account's spending controls;
no zero-cost assumption, purchase or account upgrade is authorized. Replit
database and Postmark usage remain subject to their existing plans.

## How the approved run works AFTER release of the execution hold

1. Manually dispatch **preflight** on the approved default-branch SHA. The required
   reviewer checks that exact workflow/source and its fixed scope, then approves
   the job. Download the private report. Preflight is SELECT-only and does not
   contact Postmark. It does not prove published web-process settings, sender
   approval or inbox delivery.
2. Dispatch **plan-fixtures**. Download `email-validation-<GitHub run ID>/report.json`.
   Review `result.plan` and `result.requiredAuthorization`. Only the plan object
   goes into environment secret EMAIL_VALIDATION_INPUT_JSON.
3. Dispatch **apply**, with acknowledgement exactly equal to the reviewed
   operation:sha256. The adapter independently recomputes it; the original CLI
   independently checks it again plus freshness, role, collision, baseline and
   ownership constraints. No arbitrary command, file path, SQL or shell is an input.
4. Use the normal authenticated application/API for the already-approved fixture
   evaluation/reset/update/address-reapproval actions. This runner does not create
   a public API, store account/session passwords or automate the real Admin login.
   Use **inspect** for fixed-run IDs. Capture owned records through **plan-capture**
   and its separately hashed apply. Do not send other administrators' copies.
5. For each selected due group, put the exact plan-send input in the input secret,
   dispatch **plan-send**, review its report, replace the input secret with
   `result.plan`, and dispatch **apply** with its exact acknowledgement.
   A fresh plan expires after 15 minutes, including build/reviewer waiting time.
   Replan if stale; do not extend lifetimes, replay an accepted authorization or
   bypass the hash. GitHub environment approvals protect each invocation; these
   are not additional chat approvals of individual emails.
6. Follow the nine-message timetable in email-production-execution.md. At actual
   08:00 America/New_York D1/D2, manually dispatch the due-row phases. There is no
   cron, event-driven run or broad queue drain. One scoped invocation has a
   two-minute child limit; the entire job has a ten-minute limit.
7. Inspect exact outcomes, provider IDs, deduplication and cancellations. A green
   job means the operation completed, NOT that every email arrived. Verify actual
   Gmail/Yahoo inbox receipt and reset/link behavior manually. No mailbox
   connection or inbox credential is required by this workflow.
8. **plan-cleanup**, review, then exact hashed **apply** deletes only owned
   fixture records/sessions and cancels their unsent messages. Keep the original
   business records, historical/new outbox records and authorization journals.

### Cross-invocation ceiling and interruption safety

The adapter binds all operations to the one protected UUID and the four approved
addresses, in addition to the existing fixture ownership checks. Dispatch remains
limited to evaluation_submitted, password_reset, event_created and event_reminder.
Registration/approval/rejection retain prior real-delivery evidence, not fresh
sends through this four-type CLI.

GitHub concurrency serializes invocations without cancelling a running one.
Do not queue several jobs: GitHub can replace pending concurrency jobs. For sends,
the adapter also holds a per-fixture PostgreSQL advisory lock and SELECTs the
existing authorization journal. Previous max_attempts reservations plus the
next manifest's maxSends must be <=10. The original CLI durably inserts that
reservation before any provider request. Unused reservations are NOT reclaimed;
failed/ambiguous requests count, so it can stop below ten actual provider calls.
No new table, migration or business-data budget write is introduced.

This ceiling assumes this workflow is the only operator runner for the approved
fixture UUID; do not run the original CLI separately to bypass it.
A running/interrupted journal blocks further sends. Failed/cancelled/timed-out
runs require inspecting the original durable state and Postmark before proceeding.
Do not use GitHub Re-run jobs (the adapter rejects attempts >1), automatically
retry, or generate another UUID. Recovery commands are intentionally unavailable
in this workflow; any ambiguous recovery needs an explicitly reviewed procedure.

### Subsequent live activation

This workflow never enables live mode, starts email:batch, drains a queue, installs
a scheduler or changes Replit Publishing. Runner-only controlled/validation flags
do not alter the web application. After the controlled run and exact cleanup pass,
use the separately reviewed activation/monitoring/pause procedure in
email-production-execution.md. Live activation requires its own explicit approval;
do not repurpose this workflow as a recurring live worker.
