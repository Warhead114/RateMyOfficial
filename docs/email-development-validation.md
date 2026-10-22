# Email Development validation — 2026-10-21

## Scope and workflow inventory

Development implementation and fake delivery only. Production was not changed,
no real Postmark request or email was sent, no operational scheduler was started,
and the existing controlled-delivery policy was not altered.

| Workflow | State |
|---|---|
| Exact-row controlled delivery test | Previously real-Production-verified; policy retained and regression-tested |
| Registration confirmation | Previously real-Production-verified; retained and HTTP/database regression-tested |
| Account approval | Existing delivery retained; approval now also establishes trusted coach event identity |
| Account rejection | Previously real-Production-verified; cancellation/deletion behavior retained and regression-tested |
| Evaluation confirmation | Coach confirmation retained; transactional admin/regional copies added and tested |
| Password reset | Encrypted single-use reset workflow retained; shared database rate limits and consistent lock order added |
| Event assignment/update notices | Implemented transactionally with trusted coach identity, version/identity deduplication and cancellation |
| Day-of and day-after reminders | Implemented with durable New York scheduling, eligibility rechecks and fake time/restart tests |

## Automated validation results

- Full unit suite: **89 passed, 5 database suites intentionally skipped, 0 failed**.
- Explicit Development database suite: **35 passed, 0 failed, 0 skipped**.
- Focused lifecycle coverage includes actual registration/approval/rejection,
  evaluation submissions and concurrent duplicates, invalid-event/outbox-failure
  rollback, password reset and session invalidation, event updates/deletion,
  DST dates, recipient restrictions, concurrent workers, fake retries and restart
  behavior. Shared limiter instances admit exactly the configured bound.
- Additional security regressions: self-service school/email changes cannot
  establish recipients; changing back does not restore trust; cross-region
  supervisors cannot reapprove; authorized reapproval rebuilds both future
  reminders at the new address without changing sent history; repeated saves
  do not duplicate rows; simultaneous approval and event assignment do not miss
  or duplicate the coach's notices; cancellation before the final claim fence
  prevents provider invocation.
- TypeScript: passed.
- Production build: passed. Existing Browserslist age and bundle-size/import
  warnings remain non-blocking; unrelated dependency updates were not attempted.
- `git diff --check`: passed.
- Development workflow restarted successfully; public landing screenshot loaded.
  Signed-in coach-management UI was not visually authenticated. Its HTTP/data
  paths and TypeScript/build were tested; the signed-out screenshot is not a
  claim to have visually verified that screen.
- Read-only email-status command ran successfully; Development outbox was empty
  after disposable fixture cleanup. No historical outbox purge was performed.

## Database changes

Both additive migrations were applied to the explicitly verified Development
database only:

- `20261021_email_notifications_and_shared_limits.sql`: event notification version,
  shared hashed password-reset limiter buckets and expiry index.
- `20261021_coach_notification_approval.sql`: administrator/supervisor-approved
  coach team/email identity, approval timestamp and durable identity key.

No Production migration, DATABASE_URL change, Production secret change or
Development-to-Production data copy was performed.

## Recipient and scheduling decisions

The user confirmed immediate coach assignment mail, day-of reminders and
day-after reminders only while that coach has submitted no evaluation for the
event. All event dates/start times use America/New_York. Development chose
8:00 a.m. as the documented reminder-hour default; the user did not specify an hour.

Unapproved coaches cannot receive event notices. Existing account approval
captures the trusted association; self-service changes pause notices until a
trusted manager reapproves. Legacy approved accounts require manager confirmation
in the existing coach editor, rather than an unsafe historical backfill.
Admin and verified event-region supervisors receive evaluation notices without
the evaluation's ratings or comments; null-region supervisors are excluded.

## Static security review and corrections

The review identified mutable school/email recipient trust, a cancellation gap
before provider invocation and insufficient positive database-test targeting.
The trusted identity snapshot, invalidation/reapproval path, final claim fence
and explicit expected-Development-identity checks address these findings.
A follow-up review identified lost reminders after identity changes; approval
now reconciles the coach's current assignments with identity-keyed deduplication.
The resulting regressions are covered by the passing HTTP/database tests.

Reminder reconciliation and event assignment serialize on the trusted team
before outbox locks. This prevents the two transactions from each missing the
other's uncommitted assignment/approval.

No known introduced Critical/High/Medium issue remains after these corrections.
Delivery remains explicitly **at least once**: provider acceptance followed by a
crash before database acknowledgement can produce a later repeat. A final local
claim fence cannot recall a provider request once dispatch is in flight.

## Remaining decisions, controlled tests and prerequisites

No unresolved product decision or unimplemented Development workflow remains.
All newly completed workflows await real-delivery verification; fake tests
do not establish inbox delivery or prove Production configuration.

Separately authorized exact-row real tests must cover:

1. Coach evaluation confirmation, admin copy and matching-region supervisor copy;
   verify excluded recipients receive no copy.
2. Password-reset inbox delivery, trusted URL, 30-minute expiry, single-use
   enforcement, replacement-link invalidation and prior-session invalidation.
3. Event assignment/update details, destination and New York date/start time.
4. Day-of and next-day reminder delivery at the approved schedule.
5. Day-after suppression after evaluation, reapproval to a new address, event
   rescheduling/deletion and absence of unintended duplicate delivery.

The existing controlled policy only permits the controlled-test template.
It is not a safe route for these transactional types. An operator must authorize
appropriately scoped real-validation tooling separately; broad live mode must
not be used as a substitute for controlled validation.

Before any Production rollout: separately review/apply the additive schema
changes, confirm legacy coaches' trusted details, verify required secrets and
sender/stream/APP_URL through secure settings, review any queued backlog, define
monitoring/ambiguous-send handling and obtain explicit authorization for any
worker enablement. The new one-batch command is disabled by default and cannot
drain off/controlled queues; no operational scheduler has been activated.

See `email-operations.md` for the inventory, exact recipient policy, command
guards, monitoring procedure, safe database test invocation and limitations.

**EMAIL SYSTEM DEVELOPMENT COMPLETE — READY FOR CONTROLLED PRODUCTION VALIDATION**
