import assert from "node:assert/strict";
import test from "node:test";
import { emailOutboxTypes, type EmailOutbox } from "../shared/schema";
import { FakeEmailProvider } from "../server/email/fake-provider";
import {
  createSmtpEmailProviderFromEnv,
  sanitizeProviderDiagnostic,
} from "../server/email/provider";
import {
  renderEmailTemplate,
  parseTemplatePayload,
} from "../server/email/templates";
import { retryDelayMs } from "../server/email/retry";
import { EmailDeliveryWorker, type EmailWorkerOutbox } from "../server/email/worker";
import {
  AesGcmSensitiveEmailPayloadProtector,
  parseSensitivePayloadKey,
} from "../server/email/sensitive-payload";
import { EmailDeliveryPolicy } from "../server/email/policy";

const now = new Date("2026-08-31T20:00:00.000Z");

function validPayload(type: (typeof emailOutboxTypes)[number]): Record<string, unknown> {
  switch (type) {
    case "registration_received":
      return { firstName: "Taylor", loginUrl: "/login" };
    case "account_approved":
      return { firstName: "Taylor", loginUrl: "/login" };
    case "account_rejected":
      return { firstName: "Taylor", supportUrl: "/support" };
    case "evaluation_submitted":
      return {
        firstName: "Taylor",
        eventName: "Regional Final",
        officialName: "Jordan Lee",
        isPending: false,
        reviewUrl: "/reviews/1",
      };
    case "password_reset":
      return { resetUrl: "https://example.test/reset?token=opaque", expiresInMinutes: 30 };
    case "controlled_delivery_test":
      return {};
    case "event_created":
    case "event_reminder":
      return {
        firstName: "Taylor",
        eventName: "Regional Final",
        eventStart: "August 31, 2026 at 4:00 PM Eastern",
        venue: "Central Gym",
        assignedOfficials: ["Jordan Lee"],
        eventUrl: "/events/1",
      };
  }
}

function outboxRow(
  overrides: Partial<EmailOutbox> = {},
): EmailOutbox {
  return {
    id: 1,
    type: "account_approved",
    recipientUserId: 7,
    recipientEmail: "taylor@example.test",
    payload: validPayload("account_approved"),
    encryptedPayload: null,
    deduplicationKey: "test:1",
    status: "pending",
    scheduledFor: now,
    nextAttemptAt: now,
    attemptCount: 0,
    maxAttempts: 5,
    lastErrorCode: null,
    lastError: null,
    claimedAt: null,
    claimedBy: null,
    claimToken: null,
    providerMessageId: null,
    sentAt: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class MemoryOutbox implements EmailWorkerOutbox {
  readonly rows: EmailOutbox[];

  constructor(rows: EmailOutbox[]) {
    this.rows = rows;
  }

  async getById(id: number): Promise<EmailOutbox | undefined> {
    return this.rows.find((row) => row.id === id);
  }

  async recoverStaleClaims(): Promise<number> {
    return 0;
  }

  async cancelExpiredMessages(currentTime: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (
        (row.status === "pending" || row.status === "retry_wait") &&
        row.expiresAt &&
        row.expiresAt <= currentTime
      ) {
        row.status = "cancelled";
        count += 1;
      }
    }
    return count;
  }

  async claimDueMessages(options: {
    limit: number;
    workerId: string;
    now: Date;
  }): Promise<EmailOutbox[]> {
    const claimed = this.rows
      .filter(
        (row) =>
          (row.status === "pending" || row.status === "retry_wait") &&
          row.scheduledFor <= options.now &&
          row.nextAttemptAt <= options.now &&
          (!row.expiresAt || row.expiresAt > options.now),
      )
      .slice(0, options.limit);
    for (const row of claimed) {
      row.status = "processing";
      row.claimedBy = options.workerId;
      row.claimToken = `${options.workerId}-claim-${row.id}`;
      row.claimedAt = options.now;
    }
    return claimed;
  }

  async claimExactMessage(options: {
    id: number;
    workerId: string;
    expectedType: string;
    expectedRecipientEmail: string;
    expectedDeduplicationKey: string;
    now: Date;
  }): Promise<EmailOutbox | undefined> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === options.id &&
        candidate.type === options.expectedType &&
        candidate.recipientEmail === options.expectedRecipientEmail &&
        candidate.deduplicationKey === options.expectedDeduplicationKey &&
        (candidate.status === "pending" || candidate.status === "retry_wait") &&
        candidate.scheduledFor <= options.now &&
        candidate.nextAttemptAt <= options.now &&
        candidate.attemptCount < candidate.maxAttempts &&
        (!candidate.expiresAt || candidate.expiresAt > options.now),
    );
    if (!row) return undefined;
    row.status = "processing";
    row.claimedBy = options.workerId;
    row.claimToken = `${options.workerId}-exact-${row.id}`;
    row.claimedAt = options.now;
    return row;
  }

  async cancelExpiredClaim(id: number, claimToken: string): Promise<boolean> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === id &&
        candidate.status === "processing" &&
        candidate.claimToken === claimToken,
    );
    if (!row) return false;
    row.status = "cancelled";
    row.claimedBy = null;
    row.claimToken = null;
    row.claimedAt = null;
    return true;
  }

  async markSent(
    id: number,
    providerMessageId: string | undefined,
    claimToken: string,
  ): Promise<boolean> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === id &&
        candidate.status === "processing" &&
        candidate.claimToken === claimToken,
    );
    if (!row) return false;
    row.status = "sent";
    row.providerMessageId = providerMessageId ?? null;
    row.claimedBy = null;
    row.claimToken = null;
    row.claimedAt = null;
    return true;
  }

  async markTransientFailure(
    id: number,
    failure: { errorCode: string; diagnostic: string },
    claimToken: string,
  ): Promise<boolean> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === id &&
        candidate.status === "processing" &&
        candidate.claimToken === claimToken,
    );
    if (!row) return false;
    row.status = "retry_wait";
    row.attemptCount += 1;
    row.lastErrorCode = failure.errorCode;
    row.lastError = failure.diagnostic;
    row.claimedBy = null;
    row.claimToken = null;
    row.claimedAt = null;
    return true;
  }

  async markPermanentFailure(
    id: number,
    failure: { errorCode: string; diagnostic: string },
    claimToken: string,
  ): Promise<boolean> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === id &&
        candidate.status === "processing" &&
        candidate.claimToken === claimToken,
    );
    if (!row) return false;
    row.status = "failed";
    row.attemptCount += 1;
    row.lastErrorCode = failure.errorCode;
    row.lastError = failure.diagnostic;
    row.claimedBy = null;
    row.claimToken = null;
    row.claimedAt = null;
    return true;
  }

  async renewClaim(id: number, claimToken: string): Promise<boolean> {
    return this.rows.some(
      (candidate) =>
        candidate.id === id &&
        candidate.status === "processing" &&
        candidate.claimToken === claimToken,
    );
  }
}

test("all planned template types render HTML and plain text", () => {
  for (const type of emailOutboxTypes) {
    const rendered = renderEmailTemplate(type, validPayload(type) as never);
    assert.ok(rendered.subject);
    assert.ok(rendered.html);
    assert.ok(rendered.text);
    assert.equal(rendered.metadata.type, type);
    assert.equal(rendered.metadata.privacy, "transactional");
  }

  const registration = renderEmailTemplate(
    "registration_received",
    validPayload("registration_received") as never,
  );
  assert.match(
    registration.html,
    /notify you when an administrator approves or rejects/i,
  );
  assert.match(
    registration.text,
    /notify you when an administrator approves or rejects/i,
  );

  const evaluation = renderEmailTemplate("evaluation_submitted", {
    firstName: "Taylor",
    eventName: "Regional Final",
    officialName: "Jordan Lee",
    isPending: true,
  });
  assert.match(
    evaluation.html,
    /Thank you for submitting an evaluation to RateMyOfficial/i,
  );
  assert.match(
    evaluation.text,
    /received successfully and is pending account approval/i,
  );
  assert.doesNotMatch(evaluation.html, /comment|video|mechanics|professionalism/i);
});

test("templates escape dynamic content and use fixed subjects", () => {
  const rendered = renderEmailTemplate("event_created", {
    firstName: '<img src=x onerror="alert(1)">',
    eventName: "Meet\r\nInjected subject",
    eventStart: "Tomorrow",
    venue: "<Gym>",
    assignedOfficials: ["<Official>"],
  });

  assert.match(rendered.html, /&lt;img/);
  assert.match(rendered.html, /&lt;Gym&gt;/);
  assert.doesNotMatch(rendered.html, /onerror="alert/);
  assert.equal(rendered.subject, "RateMyOfficial event assigned");
  assert.doesNotMatch(rendered.subject, /Injected/);
  assert.doesNotMatch(rendered.text, /[\r\n]{3}/);
});

test("malformed and unsafe template payloads are rejected", () => {
  assert.throws(
    () => parseTemplatePayload("password_reset", {
      resetUrl: "javascript:alert(1)",
      expiresInMinutes: 30,
    }),
    /URL/,
  );
  assert.throws(
    () => parseTemplatePayload("account_approved", {
      firstName: "Taylor",
      unexpected: "field",
    }),
    /Unrecognized key/,
  );
  assert.throws(
    () => parseTemplatePayload("event_created", {
      ...validPayload("event_created"),
      assignedOfficials: ["A".repeat(121)],
    }),
    /too_big|at most/i,
  );
});

test("sensitive email payloads use authenticated encryption", async () => {
  const protector = new AesGcmSensitiveEmailPayloadProtector(
    Buffer.alloc(32, 17),
  );
  const sensitive = {
    resetUrl: "https://example.test/reset-password?token=opaque-secret",
  };
  const sealed = await protector.seal("password_reset", sensitive);

  assert.doesNotMatch(sealed, /opaque-secret|reset-password/);
  assert.deepEqual(
    await protector.open("password_reset", sealed),
    sensitive,
  );

  const wrongKey = new AesGcmSensitiveEmailPayloadProtector(
    Buffer.alloc(32, 18),
  );
  await assert.rejects(wrongKey.open("password_reset", sealed));

  const parts = sealed.split(".");
  const tamperedCiphertext = Buffer.from(parts[3], "base64url");
  tamperedCiphertext[0] ^= 1;
  parts[3] = tamperedCiphertext.toString("base64url");
  await assert.rejects(protector.open("password_reset", parts.join(".")));

  assert.equal(
    parseSensitivePayloadKey(Buffer.alloc(32, 19).toString("base64")).length,
    32,
  );
  assert.throws(() => parseSensitivePayloadKey("too-short"));
});

test("fake provider deterministically simulates outcomes without network calls", async () => {
  const provider = new FakeEmailProvider();
  provider.queueOutcomes(
    "success",
    "transient_failure",
    "permanent_failure",
    "timeout",
    "rate_limited",
  );
  const message = {
    to: "taylor@example.test",
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
    idempotencyKey: "test:message",
  };

  assert.deepEqual(await provider.send(message), {
    outcome: "success",
    providerMessageId: "fake-message-1",
  });
  assert.equal((await provider.send(message)).outcome, "transient_failure");
  assert.equal((await provider.send(message)).outcome, "permanent_failure");
  assert.equal((await provider.send(message)).outcome, "transient_failure");
  assert.equal((await provider.send(message)).outcome, "transient_failure");
  assert.equal(provider.sentMessages.length, 1);
});

test("missing SMTP configuration fails closed without constructing a network provider", async () => {
  const provider = createSmtpEmailProviderFromEnv({});
  const result = await provider.send({
    to: "taylor@example.test",
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
    idempotencyKey: "test:fail-closed",
  });
  assert.equal(result.outcome, "permanent_failure");
  if (result.outcome !== "success") {
    assert.equal(result.errorCode, "EMAIL_CONFIGURATION_MISSING");
  }
});

test("provider diagnostics redact credentials and remain single-line and bounded", () => {
  const sanitized = sanitizeProviderDiagnostic(
    `token=top-secret\nAuthorization: Bearer abc.def.ghi ${"x".repeat(600)}`,
  );
  assert.doesNotMatch(sanitized, /top-secret|abc\.def\.ghi/);
  assert.doesNotMatch(sanitized, /[\r\n]/);
  assert.ok(sanitized.length <= 500);
});

test("retry policy is bounded and follows the approved schedule", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map(retryDelayMs),
    [30_000, 120_000, 600_000, 3_600_000, 21_600_000, 21_600_000],
  );
});

test("worker delivers successfully and persists provider message ID", async () => {
  const outbox = new MemoryOutbox([outboxRow()]);
  const provider = new FakeEmailProvider();
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "worker-a",
    now: () => now,
    policy: new EmailDeliveryPolicy({ mode: "live" }),
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    sent: 1,
    retrying: 0,
    failed: 0,
    skipped: 0,
  });
  assert.equal(outbox.rows[0].status, "sent");
  assert.equal(outbox.rows[0].providerMessageId, "fake-message-1");
});

test("worker decrypts password reset data only for fake-provider delivery", async () => {
  const protector = new AesGcmSensitiveEmailPayloadProtector(
    Buffer.alloc(32, 23),
  );
  const resetUrl =
    "https://example.test/reset-password?token=delivery-only-secret";
  const encryptedPayload = await protector.seal("password_reset", { resetUrl });
  const resetRow = outboxRow({
    id: 6,
    type: "password_reset",
    payload: { expiresInMinutes: 30 },
    encryptedPayload,
    deduplicationKey: "test:password-reset",
  });
  const outbox = new MemoryOutbox([resetRow]);
  const provider = new FakeEmailProvider();
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "worker-password-reset",
    now: () => now,
    sensitivePayloadProtector: protector,
    policy: new EmailDeliveryPolicy({ mode: "live" }),
  });

  assert.equal(provider.sentMessages.length, 0);
  assert.equal((await worker.runOnce()).sent, 1);
  assert.equal(provider.sentMessages.length, 1);
  assert.match(provider.sentMessages[0].text, /delivery-only-secret/);
  assert.doesNotMatch(JSON.stringify(resetRow.payload), /delivery-only-secret/);
});

test("worker retries transient failures and terminals permanent failures", async () => {
  const retryRow = outboxRow({ id: 2, deduplicationKey: "test:2" });
  const failedRow = outboxRow({ id: 3, deduplicationKey: "test:3" });
  const outbox = new MemoryOutbox([retryRow, failedRow]);
  const provider = new FakeEmailProvider();
  provider.queueOutcomes("transient_failure", "permanent_failure");
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "worker-b",
    now: () => now,
    policy: new EmailDeliveryPolicy({ mode: "live" }),
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 2,
    sent: 0,
    retrying: 1,
    failed: 1,
    skipped: 0,
  });
  assert.equal(retryRow.status, "retry_wait");
  assert.equal(failedRow.status, "failed");
  assert.equal(retryRow.attemptCount, 1);
  assert.equal(failedRow.attemptCount, 1);
});

test("worker never delivers expired or malformed messages", async () => {
  const expiredRow = outboxRow({
    id: 4,
    deduplicationKey: "test:4",
    expiresAt: new Date(now.getTime() - 1),
  });
  const malformedRow = outboxRow({
    id: 5,
    deduplicationKey: "test:5",
    type: "account_approved",
    payload: { firstName: "" },
  });
  const outbox = new MemoryOutbox([expiredRow, malformedRow]);
  const provider = new FakeEmailProvider();
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "worker-c",
    now: () => now,
    policy: new EmailDeliveryPolicy({ mode: "live" }),
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 1,
    sent: 0,
    retrying: 0,
    failed: 1,
    skipped: 0,
  });
  assert.equal(expiredRow.status, "cancelled");
  assert.equal(malformedRow.status, "failed");
  assert.equal(provider.sentMessages.length, 0);
});