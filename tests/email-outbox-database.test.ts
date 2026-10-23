import assert from "node:assert/strict";
import { assertDevelopmentDatabase } from "./development-database-target";
import test from "node:test";
import { eq, like } from "drizzle-orm";
import { emailOutbox } from "../shared/schema";

const RUN_DATABASE_TESTS = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

test(
  "database-backed email outbox lifecycle and concurrency",
  { skip: RUN_DATABASE_TESTS ? false : "Run with npm run test:db" },
  async (t) => {
    process.env.SKIP_DATABASE_INITIALIZATION = "1";
    const [{ db, pool }, { EmailOutboxService }] = await Promise.all([
      import("../server/db"),
      import("../server/email/outbox"),
    ]);
    await assertDevelopmentDatabase(pool);
    const service = new EmailOutboxService(db);
    const marker = `email-dbtest-${process.pid}-${Date.now()}`;
    const baseTime = new Date("2026-08-31T20:00:00.000Z");

    const enqueue = (
      suffix: string,
      overrides: Partial<Parameters<typeof service.enqueue>[0]> = {},
    ) =>
      service.enqueue({
        type: "account_approved",
        recipientEmail: `${suffix}@example.test`,
        payload: { firstName: "Taylor", loginUrl: "/login" },
        deduplicationKey: `${marker}:${suffix}`,
        scheduledFor: baseTime,
        ...overrides,
      });

    t.after(async () => {
      await db
        .delete(emailOutbox)
        .where(like(emailOutbox.deduplicationKey, `${marker}:%`));
      await db
        .delete(emailOutbox)
        .where(
          like(
            emailOutbox.deduplicationKey,
            `controlled-delivery-test:${marker}:%`,
          ),
        );
      await pool.end();
    });

    const tableCheck = await pool.query<{ email_outbox: string | null }>(
      "SELECT to_regclass('public.email_outbox')::text AS email_outbox",
    );
    assert.equal(tableCheck.rows[0].email_outbox, "email_outbox");
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'email_outbox'
         AND column_name IN ('claim_token', 'encrypted_payload')
       ORDER BY column_name`,
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ["claim_token", "encrypted_payload"],
    );
    const constraints = await pool.query<{ conname: string }>(
      `SELECT conname
       FROM pg_constraint
       WHERE conrelid = 'email_outbox'::regclass
         AND conname IN (
           'email_outbox_type_check',
           'email_outbox_status_check',
           'email_outbox_attempts_check',
           'email_outbox_password_reset_payload_check'
         )
       ORDER BY conname`,
    );
    assert.equal(constraints.rows.length, 4);

    await t.test("enqueue validates and deduplicates logical messages", async () => {
      const first = await enqueue("dedupe");
      const duplicate = await enqueue("dedupe", {
        recipientEmail: "different@example.test",
      });

      assert.equal(first.created, true);
      assert.equal(duplicate.created, false);
      assert.equal(duplicate.row.id, first.row.id);
      assert.equal(duplicate.row.recipientEmail, "dedupe@example.test");

      await assert.rejects(
        enqueue("invalid-recipient", { recipientEmail: "not-an-email" }),
        /Invalid email recipient/,
      );
      await assert.rejects(
        enqueue("invalid-payload", { payload: { firstName: "" } }),
      );
      await assert.rejects(
        service.enqueue({
          type: "password_reset",
          recipientEmail: "reset@example.test",
          payload: {
            resetUrl: "https://example.test/reset?token=must-not-be-stored",
            expiresInMinutes: 30,
          },
          deduplicationKey: `${marker}:password-reset`,
          scheduledFor: baseTime,
        }),
        /sensitive payload/,
      );
      await assert.rejects(
        db.insert(emailOutbox).values({
          type: "password_reset",
          recipientEmail: "reset-bypass@example.test",
          payload: {
            resetUrl: "https://example.test/reset?token=must-not-be-stored",
            expiresInMinutes: 30,
          },
          encryptedPayload: null,
          deduplicationKey: `${marker}:password-reset-bypass`,
          status: "pending",
          scheduledFor: baseTime,
          nextAttemptAt: baseTime,
        }),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23514",
      );
      await service.cancelUnsentMessage(first.row.id, baseTime);
    });

    await t.test("transaction rollback removes the outbox insert", async () => {
      const deduplicationKey = `${marker}:rollback`;
      await assert.rejects(
        db.transaction(async (tx) => {
          const transactionalService = service.withExecutor(tx);
          await transactionalService.enqueue({
            type: "account_approved",
            recipientEmail: "rollback@example.test",
            payload: { firstName: "Taylor" },
            deduplicationKey,
            scheduledFor: baseTime,
          });
          throw new Error("intentional rollback");
        }),
        /intentional rollback/,
      );

      const rows = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.deduplicationKey, deduplicationKey));
      assert.equal(rows.length, 0);
    });

    await t.test("concurrent workers cannot claim the same row", async () => {
      const message = await enqueue("concurrent");
      const [first, second] = await Promise.all([
        service.claimDueMessages({
          limit: 1,
          workerId: `${marker}-worker-a`,
          now: baseTime,
        }),
        service.claimDueMessages({
          limit: 1,
          workerId: `${marker}-worker-b`,
          now: baseTime,
        }),
      ]);

      assert.equal(first.length + second.length, 1);
      const claimed = first[0] ?? second[0];
      assert.equal(claimed.id, message.row.id);
      assert.equal(claimed.status, "processing");

      const claimToken = claimed.claimToken!;
      assert.equal(
        await service.markSent(
          claimed.id,
          "fake-database-provider-id",
          claimToken,
          baseTime,
        ),
        true,
      );
      const persisted = await service.getById(claimed.id);
      assert.equal(persisted?.status, "sent");
      assert.equal(persisted?.providerMessageId, "fake-database-provider-id");
      assert.equal(
        (
          await service.claimDueMessages({
            limit: 10,
            workerId: `${marker}-worker-c`,
            now: baseTime,
          })
        ).some((row) => row.id === claimed.id),
        false,
      );
    });

    await t.test("exact-row claim isolates backlog and has one concurrent owner", async () => {
      const target = await service.enqueue({
        type: "controlled_delivery_test",
        recipientEmail: "controlled@example.test",
        payload: {},
        deduplicationKey: `controlled-delivery-test:${marker}:target`,
        scheduledFor: baseTime,
      });
      const unrelatedPending = await enqueue("exact-unrelated-pending");
      const unrelatedRetry = await enqueue("exact-unrelated-retry");
      await db
        .update(emailOutbox)
        .set({ status: "retry_wait", nextAttemptAt: baseTime })
        .where(eq(emailOutbox.id, unrelatedRetry.row.id));

      const claimInput = {
        id: target.row.id,
        expectedType: target.row.type,
        expectedRecipientEmail: target.row.recipientEmail,
        expectedDeduplicationKey: target.row.deduplicationKey,
        now: baseTime,
      };
      const [first, second] = await Promise.all([
        service.claimExactMessage({
          ...claimInput,
          workerId: `${marker}-exact-a`,
        }),
        service.claimExactMessage({
          ...claimInput,
          workerId: `${marker}-exact-b`,
        }),
      ]);
      const owners = [first, second].filter(
        (row): row is NonNullable<typeof row> => Boolean(row),
      );
      assert.equal(owners.length, 1);
      assert.equal(owners[0].id, target.row.id);
      assert.equal(owners[0].status, "processing");
      assert.equal((await service.getById(unrelatedPending.row.id))?.status, "pending");
      assert.equal((await service.getById(unrelatedRetry.row.id))?.status, "retry_wait");
      assert.equal(
        await service.markSent(
          target.row.id,
          "stale-must-not-win",
          "stale-token",
          baseTime,
        ),
        false,
      );
      assert.equal(
        await service.markSent(
          target.row.id,
          "controlled-provider-id",
          owners[0].claimToken!,
          baseTime,
        ),
        true,
      );
      const persisted = await service.getById(target.row.id);
      assert.equal(persisted?.status, "sent");
      assert.equal(persisted?.providerMessageId, "controlled-provider-id");
    });

    await t.test("cancelled rows cannot be claimed", async () => {
      const message = await enqueue("cancelled");
      assert.equal(await service.cancelUnsentMessage(message.row.id, baseTime), true);
      const claimed = await service.claimDueMessages({
        limit: 25,
        workerId: `${marker}-cancel-worker`,
        now: baseTime,
      });
      assert.equal(claimed.some((row) => row.id === message.row.id), false);
      assert.equal((await service.getById(message.row.id))?.status, "cancelled");
    });

    await t.test("stale processing leases are recovered", async () => {
      const oldClaimTime = new Date(baseTime.getTime() - 10 * 60 * 1000);
      const message = await enqueue("stale", { scheduledFor: oldClaimTime });
      const claimed = await service.claimDueMessages({
        limit: 1,
        workerId: `${marker}-stale-worker`,
        now: oldClaimTime,
      });
      assert.equal(claimed[0].id, message.row.id);
      const staleClaimToken = claimed[0].claimToken!;

      assert.equal(await service.recoverStaleClaims(baseTime, 60_000), 1);
      const recoveredRow = await service.getById(message.row.id);
      assert.equal(recoveredRow?.status, "retry_wait");
      assert.equal(recoveredRow?.attemptCount, 1);
      assert.equal(
        await service.markSent(
          message.row.id,
          "stale-worker-must-not-win",
          staleClaimToken,
          baseTime,
        ),
        false,
      );

      const reclaimed = await service.claimDueMessages({
        limit: 25,
        workerId: `${marker}-recovery-worker`,
        now: baseTime,
      });
      const reclaimedRow = reclaimed.find((row) => row.id === message.row.id);
      assert.ok(reclaimedRow);
      assert.notEqual(reclaimedRow.claimToken, staleClaimToken);
    });

    await t.test("a message expiring during delivery cannot be finalized as sent", async () => {
      const expiresAt = new Date(baseTime.getTime() + 1_000);
      const message = await enqueue("expires-in-flight", { expiresAt });
      const [claimed] = await service.claimDueMessages({
        limit: 1,
        workerId: `${marker}-expiry-worker`,
        now: baseTime,
      });
      assert.equal(claimed.id, message.row.id);
      const completedAt = new Date(expiresAt.getTime() + 1);
      assert.equal(
        await service.markSent(
          claimed.id,
          "must-not-persist",
          claimed.claimToken!,
          completedAt,
        ),
        false,
      );
      assert.equal(
        await service.cancelExpiredClaim(
          claimed.id,
          claimed.claimToken!,
          completedAt,
        ),
        true,
      );
      const persisted = await service.getById(claimed.id);
      assert.equal(persisted?.status, "cancelled");
      assert.equal(persisted?.providerMessageId, null);
    });

    await t.test("a failed provider attempt completing after expiry is cancelled", async () => {
      const expiresAt = new Date(baseTime.getTime() + 1_000);
      const message = await enqueue("failure-after-expiry", { expiresAt });
      const [claimed] = await service.claimDueMessages({
        limit: 1,
        workerId: `${marker}-expired-failure-worker`,
        now: baseTime,
      });
      const completedAt = new Date(expiresAt.getTime() + 1);
      assert.equal(
        await service.markTransientFailure(
          claimed.id,
          {
            outcome: "transient_failure",
            errorCode: "TIMEOUT",
            diagnostic: "Provider attempt exceeded delivery deadline",
          },
          claimed.claimToken!,
          completedAt,
        ),
        true,
      );
      const persisted = await service.getById(message.row.id);
      assert.equal(persisted?.status, "cancelled");
      assert.equal(persisted?.lastErrorCode, "EXPIRED");
    });

    await t.test("retry waiting honors eligibility and maximum attempts", async () => {
      const message = await enqueue("retry", { maxAttempts: 2 });
      const [claimed] = await service.claimDueMessages({
        limit: 1,
        workerId: `${marker}-retry-worker`,
        now: baseTime,
      });
      assert.equal(claimed.id, message.row.id);
      await service.markTransientFailure(
        claimed.id,
        {
          outcome: "transient_failure",
          errorCode: "RATE_LIMITED",
          diagnostic: "Temporary provider limit",
        },
        claimed.claimToken!,
        baseTime,
      );

      const retryRow = await service.getById(message.row.id);
      assert.equal(retryRow?.status, "retry_wait");
      assert.equal(retryRow?.attemptCount, 1);
      assert.equal(
        (
          await service.claimDueMessages({
            limit: 25,
            workerId: `${marker}-too-early`,
            now: new Date(baseTime.getTime() + 29_999),
          })
        ).some((row) => row.id === message.row.id),
        false,
      );

      const [retried] = await service.claimDueMessages({
        limit: 1,
        workerId: `${marker}-retry-worker-2`,
        now: new Date(baseTime.getTime() + 30_000),
      });
      assert.equal(retried.id, message.row.id);
      await service.markTransientFailure(
        retried.id,
        {
          outcome: "transient_failure",
          errorCode: "TIMEOUT",
          diagnostic: "Temporary timeout",
        },
        retried.claimToken!,
        new Date(baseTime.getTime() + 30_000),
      );
      const exhausted = await service.getById(message.row.id);
      assert.equal(exhausted?.status, "failed");
      assert.equal(exhausted?.attemptCount, 2);
    });

    await t.test("permanent and expired messages become terminal", async () => {
      const permanent = await enqueue("permanent");
      const [claimed] = await service.claimDueMessages({
        limit: 1,
        workerId: `${marker}-permanent-worker`,
        now: baseTime,
      });
      assert.equal(claimed.id, permanent.row.id);
      await service.markPermanentFailure(
        claimed.id,
        {
          outcome: "permanent_failure",
          errorCode: "INVALID_RECIPIENT",
          diagnostic: "Recipient rejected",
        },
        claimed.claimToken!,
        baseTime,
      );
      assert.equal((await service.getById(permanent.row.id))?.status, "failed");

      const expired = await enqueue("expired", {
        expiresAt: new Date(baseTime.getTime() - 1),
      });
      assert.ok(await service.cancelExpiredMessages(baseTime));
      assert.equal((await service.getById(expired.row.id))?.status, "cancelled");
      assert.equal(
        (
          await service.claimDueMessages({
            limit: 25,
            workerId: `${marker}-expired-worker`,
            now: baseTime,
          })
        ).some((row) => row.id === expired.row.id),
        false,
      );
    });
  },
);