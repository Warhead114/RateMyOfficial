# Email validation tooling — Development completion review

Date: 2026-10-21. Scope: Development implementation, fake delivery and documentation.

## Implementation

Disabled-by-default privileged CLI, not a dispatch endpoint. Immutable short-lived
send manifests select exact captured fixture outbox IDs, types and recipients.
Durable one-shot authorization and attempt consumption prevent replay and budget
reset. Provider attempts are capped at ten per authorization, including failures.
Normal encryption, eligibility, due checks, retries and final claim fencing remain.
The ordinary controlled-test policy and broad worker behavior are unchanged.

Fixture creation is dry-run-first and atomic. Exact IDs are retained in a durable
ledger; subsequent normal application actions require explicit ID capture.
Creation, capture, send, recovery and cleanup have separate operator/hash gates.
Cleanup refuses unrelated records and in-flight work, cancels unsent fixture mail,
redacts reset ciphertext using the existing outbox service, preserves historical
outbox rows and recalculates only the disposable official's ratings.

## Verification

| Check | Result |
| --- | --- |
| Focused manifest/policy unit tests | 4 passed |
| New scoped Development lifecycle group | 8 passed, including its parent |
| Full unit command | 93 passed, 6 database groups intentionally skipped |
| Explicit Development database command | 43 passed, 0 failed/skipped |
| TypeScript | Passed |
| Production build | Passed; both dist/index.js and dist/email-validation.js verified |
| Built CLI with no command/approval | Refused with exit 1 |
| git diff --check | Passed |
| Static security review | Findings addressed; see below |
| Development application restart | Serving on port 5000 |
| Public preview | Landing page rendered; anonymous auth lookup correctly returned 401 |

Database writes were positively guarded against the Development database.
Providers were injected fakes; no Postmark calls were made. Eighteen dynamically
allocated Development stand-ins plus any preexisting nonfixture officials were
protected in the cleanup test. This is not a claim that Production was queried
or tested during this task.

Coverage includes evaluation confirmation/admin/regional copies, encrypted reset,
assignment, both reminder days, suppression after evaluation, alternate-address
reapproval, event rescheduling/deletion, provider failure/retry, stale exact-claim
recovery, old-token fencing and unrelated queued messages remaining untouched.
Adversarial tests reject unauthorized recipients, changed row IDs/content,
incorrect operation approvals, duplicate invocations, unrelated capture/deletion,
malformed reviewer links/deduplication keys and stale cleanup snapshots.

The static review identified sensitive ciphertext retention, an overly restrictive
long-lived official snapshot, and insufficient reviewer-recipient ownership.
Corrections use existing redaction, fresh independently approved cleanup snapshots,
and exact review/recipient/role/region/link checks. Tests cover those corrections.
The added provider budget checks also renew the claim fence again immediately
before the underlying send.

The build has the existing nonblocking large-client-chunk warning. No frontend
layout was changed. No remaining high/blocking tooling defect is known after
the corrections and completed checks.

## Operations and remaining prerequisites

The complete commands, independent approval steps, scheduler/pause/retry/restart
procedures and legacy identity checklist are in
[email-scoped-validation.md](email-scoped-validation.md).

Before Production use: separately authorize deployment/schema review, verify
secure runtime configuration and sender/Reply-To/stream/trusted URL, approve all
disposable inboxes and fixture writes, approve exact real sends, verify real
calendar-day delivery and inbox rendering, then independently approve cleanup.
Live scheduler/alert configuration remains a later separately authorized step.

Legacy regions/affiliations still require administrator review. The subsequent
completion pass adds separate Admin-only **Save region** controls to the coach
and team edit dialogs, backed by strict authenticated Admin endpoints. Region
saves never grant account or notification approval; existing profile reapproval
remains a deliberate separate save. No inferred regions or bulk backfill is
implemented. See email-scoped-validation.md for the updated operator checklist.

Only the two new journal tables were migrated in Development. No Production
migration, Production data/configuration change, secret change, publish, real
send or scheduler activation occurred. No Production testing is authorized.

## Exact changed files

```text
.agents/memory/MEMORY.md
.agents/memory/email-validation-protection.md
.gitignore
.replitignore
docs/email-operations.md
docs/email-scoped-validation.md
docs/email-validation-tooling-review.md
migrations/20261021_email_validation_journals.sql
package.json
scripts/email-validation.ts
server/email/outbox.ts
server/email/render-outbox.ts
server/email/validation/cleanup.ts
server/email/validation/contracts.ts
server/email/validation/dispatch.ts
server/email/validation/fixtures.ts
server/email/validation/scoped-policy.ts
server/email/worker.ts
shared/schema.ts
tests/email-validation-database.test.ts
tests/email-validation.test.ts
```
