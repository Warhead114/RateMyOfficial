import { randomUUID } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import * as s from "@shared/schema";
import { clearedEncryptedPayload, EmailOutboxService } from "../outbox";
import { EmailDeliveryWorker } from "../worker";
import { type EmailProvider, PostmarkEmailProvider } from "../provider";
import type { SensitiveEmailPayloadProtector } from "../sensitive-payload";
import { renderOutboxMessage } from "../render-outbox";
import { DEFAULT_LEASE_MS } from "../retry";
import { approvedRecipients, assertOwnedOutbox, loadFixture } from "./fixtures";
import { demand, digest, exactEmail, freshWindow, ids, operatorGate,
  rowHash, sendManifest, type SendManifest } from "./contracts";
import { ScopedValidationPolicy } from "./scoped-policy";

interface Context {
  protector: SensitiveEmailPayloadProtector;
  replyTo: string | null;
  now?: () => Date;
}
export async function planSend(executor: any, input: {
  fixtureRunId: string; rowIds: number[]; recipients: string[];
  permittedTypes: string[]; approvedBy: string;
}, context: Context) {
  ids.parse(input.rowIds);
  demand(input.rowIds.length >= 1 && input.rowIds.length <= 10, "Select 1–10 exact rows");
  const { records } = await loadFixture(executor, input.fixtureRunId);
  const now = context.now?.() ?? new Date();
  const rows = [];
  for (const id of input.rowIds) {
    demand(records.outboxIds.includes(id), "Outbox row was not explicitly captured");
    const [row] = await executor.select().from(s.emailOutbox).where(eq(s.emailOutbox.id, id));
    demand(row && ["pending", "retry_wait"].includes(row.status) &&
      row.scheduledFor <= now && row.nextAttemptAt <= now &&
      (!row.expiresAt || row.expiresAt > now), "Selected row is not due/eligible for claiming");
    await assertOwnedOutbox(executor, records, row);
    rows.push({ id, type: row.type, recipientEmail: row.recipientEmail, rowHash: rowHash(row),
      messageHash: digest(await renderOutboxMessage(row, context.protector, context.replyTo)) });
  }
  demand(input.recipients.every((email) => approvedRecipients(records).includes(exactEmail(email))),
    "Recipient not approved for fixture run");
  return sendManifest.parse({ kind: "send", authorizationId: randomUUID(),
    fixtureRunId: input.fixtureRunId, approvedBy: input.approvedBy,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    rows, recipients: input.recipients, permittedTypes: input.permittedTypes, maxSends: rows.length });
}

// Constructed only after the CLI's operator authorization and preflight.
// It has no SMTP fallback and never changes the ordinary application policy.
export function scopedPostmarkProvider(policy: ScopedValidationPolicy, env = process.env): EmailProvider {
  demand(env.POSTMARK_SERVER_TOKEN && env.EMAIL_FROM && env.EMAIL_REPLY_TO, "Postmark configuration incomplete");
  return new PostmarkEmailProvider({ serverToken: env.POSTMARK_SERVER_TOKEN,
    from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO,
    messageStream: env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound", policy });
}
export async function executeSend(executor: any, raw: unknown, acknowledgement: string,
  context: Context & { env?: NodeJS.ProcessEnv; providerFactory: (policy: ScopedValidationPolicy) => EmailProvider }) {
  const manifest = sendManifest.parse(raw), hash = digest(manifest);
  const env = context.env ?? process.env, clock = context.now ?? (() => new Date());
  operatorGate("send", manifest, acknowledgement, env);
  freshWindow(manifest.createdAt, manifest.expiresAt, clock());
  const { records } = await loadFixture(executor, manifest.fixtureRunId);
  demand(manifest.recipients.every((email) => approvedRecipients(records).includes(email)),
    "Unapproved manifest recipient");
  const initialRows = new Map<number, s.EmailOutbox>();
  for (const expected of manifest.rows) {
    demand(records.outboxIds.includes(expected.id), "Uncaptured row ID");
    const [row] = await executor.select().from(s.emailOutbox).where(eq(s.emailOutbox.id, expected.id));
    demand(row && rowHash(row) === expected.rowHash &&
      row.type === expected.type && row.recipientEmail === expected.recipientEmail,
    "Outbox content/identity changed after approval");
    await assertOwnedOutbox(executor, records, row);
    demand(digest(await renderOutboxMessage(row, context.protector, context.replyTo)) === expected.messageHash,
      "Rendered message changed");
    initialRows.set(row.id, row);
  }
  const policy = new ScopedValidationPolicy(manifest, clock);
  const underlying = context.providerFactory(policy);
  demand(!underlying.configurationFailure?.(), "Provider configuration refused");
  await executor.transaction(async (tx: any) => {
    await tx.select().from(s.emailValidationFixtures)
      .where(eq(s.emailValidationFixtures.runId, manifest.fixtureRunId)).for("update");
    await loadFixture(tx, manifest.fixtureRunId);
    const active = await tx.select().from(s.emailValidationAuthorizations).where(and(
      eq(s.emailValidationAuthorizations.fixtureRunId, manifest.fixtureRunId),
      eq(s.emailValidationAuthorizations.state, "running"),
      gt(s.emailValidationAuthorizations.expiresAt, clock())));
    demand(!active.length, "Another operator invocation is active");
    await tx.insert(s.emailValidationAuthorizations).values({
      authorizationId: manifest.authorizationId, fixtureRunId: manifest.fixtureRunId,
      manifestHash: hash, state: "running", maxAttempts: manifest.maxSends,
      expiresAt: new Date(manifest.expiresAt),
    }); // Unique authorization/hash: a crash/replay cannot reset the budget.
  });
  const workerId = `validation:${manifest.authorizationId}`;
  const outbox = new EmailOutboxService(executor);
  const provider: EmailProvider = {
    configurationFailure: () => underlying.configurationFailure?.() ?? null,
    send: async (message) => {
      try {
        freshWindow(manifest.createdAt, manifest.expiresAt, clock());
        const expected = manifest.rows.find((e) =>
          initialRows.get(e.id)?.deduplicationKey === message.idempotencyKey);
        demand(expected && expected.recipientEmail === message.to &&
          message.metadata?.type === expected.type && digest(message) === expected.messageHash,
        "Provider message is outside the approved manifest");
        const row = await outbox.getById(expected.id);
        demand(row && row.status === "processing" && row.claimedBy === workerId &&
          row.claimToken && rowHash(row) === expected.rowHash, "Final row authorization lost");
        demand(policy.authorizeControlledRow(row).allowed, "Row outside scoped authorization");
        // Persist consumption BEFORE any external request. Failed/ambiguous requests
        // consume a slot too; the same row cannot consume a second slot in this run.
        const consumed = await executor.update(s.emailValidationAuthorizations).set({
          attemptsUsed: sql`${s.emailValidationAuthorizations.attemptsUsed} + 1`,
          attemptedRowIds: sql`${s.emailValidationAuthorizations.attemptedRowIds} || ${JSON.stringify([row.id])}::jsonb`,
        }).where(and(
          eq(s.emailValidationAuthorizations.authorizationId, manifest.authorizationId),
          eq(s.emailValidationAuthorizations.manifestHash, hash),
          eq(s.emailValidationAuthorizations.state, "running"),
          lt(s.emailValidationAuthorizations.attemptsUsed, manifest.maxSends),
          gt(s.emailValidationAuthorizations.expiresAt, clock()),
          sql`NOT (${s.emailValidationAuthorizations.attemptedRowIds} @> ${JSON.stringify([row.id])}::jsonb)`,
        )).returning({ id: s.emailValidationAuthorizations.authorizationId });
        demand(consumed.length === 1, "Durable send budget exhausted");
        // Restore the final fence after our additional asynchronous budget checks.
        demand(await outbox.renewClaim(row.id, row.claimToken, clock()), "Final claim fence lost");
        freshWindow(manifest.createdAt, manifest.expiresAt, clock());
      } catch {
        return { outcome: "permanent_failure", errorCode: "SCOPED_VALIDATION_BLOCKED",
          diagnostic: "Scoped provider authorization failed; review exact run journal" };
      }
      return underlying.send(message);
    },
  };
  try {
    const worker = new EmailDeliveryWorker(outbox, provider, {
      workerId, policy, now: clock, replyTo: context.replyTo,
      sensitivePayloadProtector: context.protector,
    });
    const results = [];
    for (const expected of manifest.rows) results.push({ id: expected.id,
      result: await worker.runScopedValidationOnce(expected.id) });
    await executor.update(s.emailValidationAuthorizations).set({ state: "complete" })
      .where(eq(s.emailValidationAuthorizations.authorizationId, manifest.authorizationId));
    return results;
  } catch {
    await executor.update(s.emailValidationAuthorizations).set({ state: "interrupted" })
      .where(eq(s.emailValidationAuthorizations.authorizationId, manifest.authorizationId));
    throw new Error("Validation interrupted; inspect claims/provider acceptance before retrying");
  }
}

export async function planRecovery(executor: any, fixtureRunId: string, rowId: number) {
  const { records } = await loadFixture(executor, fixtureRunId, true);
  demand(records.outboxIds.includes(rowId), "Uncaptured recovery row");
  const [row] = await executor.select().from(s.emailOutbox).where(eq(s.emailOutbox.id, rowId));
  demand(row?.status === "processing" && row.claimToken &&
    row.claimedBy?.startsWith("validation:") && row.claimedAt &&
    row.claimedAt.getTime() <= Date.now() - DEFAULT_LEASE_MS, "Not a stale validation claim");
  await assertOwnedOutbox(executor, records, row);
  return { kind: "recover" as const, fixtureRunId, rowId,
    claimHash: digest({ token: row.claimToken, by: row.claimedBy, at: row.claimedAt }),
    rowHash: rowHash(row), acknowledgePossibleDuplicate: true };
}
export async function recoverClaim(executor: any, plan: Awaited<ReturnType<typeof planRecovery>>,
  acknowledgement: string, env = process.env) {
  operatorGate("recover", plan, acknowledgement, env);
  return executor.transaction(async (tx: any) => {
    await tx.select().from(s.emailValidationFixtures)
      .where(eq(s.emailValidationFixtures.runId, plan.fixtureRunId)).for("update");
    await tx.select().from(s.emailOutbox).where(eq(s.emailOutbox.id, plan.rowId)).for("update");
    demand(digest(await planRecovery(tx, plan.fixtureRunId, plan.rowId)) === digest(plan),
      "Recovery claim changed");
    const [row] = await tx.select().from(s.emailOutbox).where(eq(s.emailOutbox.id, plan.rowId));
    const expired = row.expiresAt && row.expiresAt <= new Date();
    const attemptCount = row.attemptCount + 1;
    await tx.update(s.emailOutbox).set({
      status: expired ? "cancelled" : attemptCount >= row.maxAttempts ? "failed" : "retry_wait",
      attemptCount, claimedAt: null, claimedBy: null, claimToken: null,
      encryptedPayload: expired || attemptCount >= row.maxAttempts ? clearedEncryptedPayload() : row.encryptedPayload,
      nextAttemptAt: new Date(), updatedAt: new Date(), lastErrorCode: "OPERATOR_REVIEWED_STALE_CLAIM",
      lastError: "Possible provider acceptance reviewed before exact recovery",
    }).where(eq(s.emailOutbox.id, plan.rowId));
    return { recoveredId: plan.rowId, sendRequiresNewAuthorization: true };
  });
}
