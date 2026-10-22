import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { EmailOutbox } from "../shared/schema";
import { enqueueControlledDeliveryTest } from "../server/email/controlled-test";
import { FakeEmailProvider } from "../server/email/fake-provider";
import {
  EmailDeliveryPolicy,
  createEmailDeliveryPolicyFromEnv,
} from "../server/email/policy";
import {
  PostmarkEmailProvider,
  SmtpEmailProvider,
  createPostmarkEmailProviderFromEnv,
  type EmailMessage,
} from "../server/email/provider";
import {
  EmailDeliveryWorker,
  type EmailWorkerOutbox,
} from "../server/email/worker";

const now = new Date("2026-08-31T20:00:00.000Z");
const authorizedRecipient = "authorized@example.test";

function controlledPolicy(): EmailDeliveryPolicy {
  return new EmailDeliveryPolicy({
    mode: "controlled",
    controlledRecipients: [authorizedRecipient],
  });
}

function controlledRow(overrides: Partial<EmailOutbox> = {}): EmailOutbox {
  return {
    id: 100,
    type: "controlled_delivery_test",
    recipientUserId: null,
    recipientEmail: authorizedRecipient,
    payload: {},
    encryptedPayload: null,
    deduplicationKey: "controlled-delivery-test:authorized-run",
    status: "pending",
    scheduledFor: now,
    nextAttemptAt: now,
    attemptCount: 0,
    maxAttempts: 2,
    lastErrorCode: null,
    lastError: null,
    claimedAt: null,
    claimedBy: null,
    claimToken: null,
    providerMessageId: null,
    sentAt: null,
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class ControlledMemoryOutbox implements EmailWorkerOutbox {
  broadClaimCalls = 0;

  constructor(readonly rows: EmailOutbox[]) {}

  async getById(id: number): Promise<EmailOutbox | undefined> {
    return this.rows.find((row) => row.id === id);
  }

  async recoverStaleClaims(): Promise<number> {
    return 0;
  }

  async cancelExpiredMessages(): Promise<number> {
    return 0;
  }

  async claimDueMessages(): Promise<EmailOutbox[]> {
    this.broadClaimCalls += 1;
    return [];
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
    row.claimedAt = options.now;
    row.claimedBy = options.workerId;
    row.claimToken = `${options.workerId}:${row.id}`;
    return row;
  }

  async cancelExpiredClaim(id: number, claimToken: string): Promise<boolean> {
    return this.updateClaim(id, claimToken, (row) => {
      row.status = "cancelled";
    });
  }

  async renewClaim(id: number, claimToken: string): Promise<boolean> {
    return this.rows.some(
      (row) =>
        row.id === id &&
        row.status === "processing" &&
        row.claimToken === claimToken,
    );
  }

  async markSent(
    id: number,
    providerMessageId: string | undefined,
    claimToken: string,
    completedAt: Date,
  ): Promise<boolean> {
    return this.updateClaim(id, claimToken, (row) => {
      row.status = "sent";
      row.attemptCount += 1;
      row.providerMessageId = providerMessageId ?? null;
      row.sentAt = completedAt;
    });
  }

  async markTransientFailure(
    id: number,
    failure: { errorCode: string; diagnostic: string },
    claimToken: string,
  ): Promise<boolean> {
    return this.updateClaim(id, claimToken, (row) => {
      row.status = "retry_wait";
      row.attemptCount += 1;
      row.lastErrorCode = failure.errorCode;
      row.lastError = failure.diagnostic;
    });
  }

  async markPermanentFailure(
    id: number,
    failure: { errorCode: string; diagnostic: string },
    claimToken: string,
  ): Promise<boolean> {
    return this.updateClaim(id, claimToken, (row) => {
      row.status = "failed";
      row.attemptCount += 1;
      row.lastErrorCode = failure.errorCode;
      row.lastError = failure.diagnostic;
    });
  }

  private updateClaim(
    id: number,
    claimToken: string,
    update: (row: EmailOutbox) => void,
  ): boolean {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === id &&
        candidate.status === "processing" &&
        candidate.claimToken === claimToken,
    );
    if (!row) return false;
    update(row);
    row.claimedAt = null;
    row.claimedBy = null;
    row.claimToken = null;
    return true;
  }
}

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: authorizedRecipient,
    replyTo: "support@example.test",
    subject: "RateMyOfficial email delivery test",
    html: "<p>This is an authorized test.</p>",
    text: "This is an authorized test.",
    idempotencyKey: "controlled-delivery-test:authorized-run",
    metadata: {
      type: "controlled_delivery_test",
      privacy: "transactional",
    },
    ...overrides,
  };
}

test("delivery mode defaults and malformed values fail closed", () => {
  for (const value of [undefined, "", " control ", "enabled", "LIVE!"]) {
    assert.equal(
      createEmailDeliveryPolicyFromEnv({
        EMAIL_DELIVERY_MODE: value,
      }).mode,
      "off",
    );
  }
  assert.equal(
    createEmailDeliveryPolicyFromEnv({
      EMAIL_DELIVERY_MODE: " controlled ",
      EMAIL_CONTROLLED_RECIPIENTS: authorizedRecipient,
    }).mode,
    "controlled",
  );
  assert.equal(
    createEmailDeliveryPolicyFromEnv({
      EMAIL_DELIVERY_MODE: "live",
    }).mode,
    "live",
  );
});

test("controlled allowlist uses normalized exact matching and never reroutes", () => {
  const policy = new EmailDeliveryPolicy({
    mode: "controlled",
    controlledRecipients: ["  Authorized@Example.Test  "],
  });
  assert.equal(policy.isControlledRecipient("authorized@example.test"), true);
  assert.equal(policy.isControlledRecipient("AUTHORIZED@EXAMPLE.TEST"), true);
  assert.equal(policy.isControlledRecipient("authorized@example.test.attacker"), false);
  assert.equal(policy.isControlledRecipient("other@example.test"), false);
  assert.equal(
    policy.authorizeProviderMessage({
      recipientEmail: "other@example.test",
      emailType: "controlled_delivery_test",
    }).allowed,
    false,
  );

  const malformed = new EmailDeliveryPolicy({
    mode: "controlled",
    controlledRecipients: "authorized@example.test,not-an-address",
  });
  assert.equal(malformed.controlledRecipientsValid, false);
  assert.equal(
    malformed.authorizeProviderMessage({
      recipientEmail: authorizedRecipient,
      emailType: "controlled_delivery_test",
    }).allowed,
    false,
  );
});

test("Postmark adapter maps safe fields and captures message ID", async () => {
  let request:
    | { input: Parameters<typeof fetch>[0]; init?: Parameters<typeof fetch>[1] }
    | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({
      ErrorCode: 0,
      Message: "OK",
      MessageID: "postmark-message-123",
    }), { status: 200 });
  };
  const provider = new PostmarkEmailProvider({
    serverToken: "test-server-token",
    from: "RateMyOfficial <notifications@example.test>",
    replyTo: "support@example.test",
    messageStream: "outbound",
    fetchImpl,
    policy: controlledPolicy(),
  });

  assert.deepEqual(await provider.send(message()), {
    outcome: "success",
    providerMessageId: "postmark-message-123",
  });
  assert.equal(request?.input, "https://api.postmarkapp.com/email");
  assert.equal(request?.init?.method, "POST");
  const headers = request?.init?.headers as Record<string, string>;
  assert.equal(headers["X-Postmark-Server-Token"], "test-server-token");
  const body = JSON.parse(String(request?.init?.body));
  assert.equal(body.From, "RateMyOfficial <notifications@example.test>");
  assert.equal(body.To, authorizedRecipient);
  assert.equal(body.ReplyTo, "support@example.test");
  assert.equal(body.Subject, "RateMyOfficial email delivery test");
  assert.equal(body.HtmlBody, "<p>This is an authorized test.</p>");
  assert.equal(body.TextBody, "This is an authorized test.");
  assert.equal(body.MessageStream, "outbound");
  assert.deepEqual(body.Metadata, {
    type: "controlled_delivery_test",
    privacy: "transactional",
  });
  assert.doesNotMatch(JSON.stringify(body.Metadata), /token|password|resetUrl/i);
});

test("Postmark policy block makes zero network requests and preserves recipient", async () => {
  let fetchCalls = 0;
  const provider = new PostmarkEmailProvider({
    serverToken: "test-server-token",
    from: "notifications@example.test",
    replyTo: "support@example.test",
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
    policy: controlledPolicy(),
  });
  const blocked = message({ to: "other@example.test" });
  const result = await provider.send(blocked);
  assert.equal(result.outcome, "permanent_failure");
  assert.equal(fetchCalls, 0);
  assert.equal(blocked.to, "other@example.test");
});

test("Postmark error and malformed response classifications are bounded", async () => {
  const cases = [
    { status: 429, outcome: "transient_failure" },
    { status: 500, outcome: "transient_failure" },
    { status: 503, outcome: "transient_failure" },
    { status: 400, outcome: "permanent_failure" },
    { status: 401, outcome: "permanent_failure" },
    { status: 422, outcome: "permanent_failure" },
  ] as const;
  for (const item of cases) {
    const provider = new PostmarkEmailProvider({
      serverToken: "test-server-token",
      from: "notifications@example.test",
      replyTo: "support@example.test",
      fetchImpl: (async () =>
        new Response(JSON.stringify({
          ErrorCode: item.status,
          Message: `Provider error ${item.status}`,
        }), { status: item.status })) as typeof fetch,
      policy: controlledPolicy(),
    });
    assert.equal((await provider.send(message())).outcome, item.outcome);
  }

  const malformed = new PostmarkEmailProvider({
    serverToken: "test-server-token",
    from: "notifications@example.test",
    replyTo: "support@example.test",
    fetchImpl: (async () =>
      new Response("{}", { status: 200 })) as typeof fetch,
    policy: controlledPolicy(),
  });
  const malformedResult = await malformed.send(message());
  assert.equal(malformedResult.outcome, "permanent_failure");
  if (malformedResult.outcome !== "success") {
    assert.equal(malformedResult.errorCode, "POSTMARK_MALFORMED_RESPONSE");
  }
});

test("Postmark network diagnostics redact credentials and timeout is transient", async () => {
  const networkFailure = new PostmarkEmailProvider({
    serverToken: "test-server-token",
    from: "notifications@example.test",
    replyTo: "support@example.test",
    fetchImpl: (async () => {
      throw new Error("token=top-secret Authorization: Bearer abc.def.ghi");
    }) as typeof fetch,
    policy: controlledPolicy(),
  });
  const networkResult = await networkFailure.send(message());
  assert.equal(networkResult.outcome, "transient_failure");
  if (networkResult.outcome !== "success") {
    assert.doesNotMatch(networkResult.diagnostic, /top-secret|abc\.def\.ghi/);
  }

  const timeoutProvider = new PostmarkEmailProvider({
    serverToken: "test-server-token",
    from: "notifications@example.test",
    replyTo: "support@example.test",
    timeoutMs: 5,
    fetchImpl: ((_, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch,
    policy: controlledPolicy(),
  });
  const timeoutResult = await timeoutProvider.send(message());
  assert.equal(timeoutResult.outcome, "transient_failure");
  if (timeoutResult.outcome !== "success") {
    assert.equal(timeoutResult.errorCode, "POSTMARK_TIMEOUT");
  }
});

test("Postmark environment factory fails closed before network access", async () => {
  let fetchCalls = 0;
  const provider = createPostmarkEmailProviderFromEnv(
    {
      EMAIL_DELIVERY_MODE: "controlled",
      EMAIL_CONTROLLED_RECIPIENTS: authorizedRecipient,
      POSTMARK_SERVER_TOKEN: "test-token",
      EMAIL_FROM: "notifications@example.test",
    },
    {
      fetchImpl: (async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    },
  );
  const result = await provider.send(message());
  assert.equal(result.outcome, "permanent_failure");
  assert.equal(fetchCalls, 0);
});

test("off and controlled policy block SMTP before transport access", async () => {
  for (const policy of [
    new EmailDeliveryPolicy({ mode: "off" }),
    controlledPolicy(),
  ]) {
    let transportCalls = 0;
    const provider = new SmtpEmailProvider({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      user: "test-user",
      password: "test-password",
      from: "notifications@example.test",
      replyTo: "support@example.test",
      policy,
    });
    (provider as unknown as {
      transporter: { sendMail: () => Promise<{ messageId: string }> };
    }).transporter = {
      async sendMail() {
        transportCalls += 1;
        return { messageId: "must-not-send" };
      },
    };
    const result = await provider.send(message({
      metadata: {
        type: policy.mode === "controlled"
          ? "account_approved"
          : "controlled_delivery_test",
        privacy: "transactional",
      },
    }));
    assert.equal(result.outcome, "permanent_failure");
    assert.equal(transportCalls, 0);
  }
});

test("invalid controlled provider configuration does not claim or mutate row", async () => {
  const target = controlledRow({ id: 90 });
  const outbox = new ControlledMemoryOutbox([target]);
  const provider = createPostmarkEmailProviderFromEnv({
    EMAIL_DELIVERY_MODE: "controlled",
    EMAIL_CONTROLLED_RECIPIENTS: authorizedRecipient,
    POSTMARK_SERVER_TOKEN: "test-token",
    EMAIL_FROM: "notifications@example.test",
  });
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "invalid-config-worker",
    now: () => now,
    policy: controlledPolicy(),
  });

  assert.deepEqual(await worker.runExactOnce(target.id), {
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    skipped: 1,
  });
  assert.equal(target.status, "pending");
  assert.equal(target.attemptCount, 0);
  assert.equal(target.claimToken, null);
});

test("provider-supplied diagnostics cannot persist recipient or URL data", async () => {
  const provider = new PostmarkEmailProvider({
    serverToken: "test-server-token",
    from: "notifications@example.test",
    replyTo: "support@example.test",
    fetchImpl: (async () =>
      new Response(JSON.stringify({
        ErrorCode: 300,
        Message: "Recipient authorized@example.test rejected at https://example.test/reset?token=secret",
      }), { status: 422 })) as typeof fetch,
    policy: controlledPolicy(),
  });
  const result = await provider.send(message());
  assert.equal(result.outcome, "permanent_failure");
  if (result.outcome !== "success") {
    assert.doesNotMatch(
      result.diagnostic,
      /authorized@example\.test|example\.test\/reset|token=secret/i,
    );
  }
});

test("controlled test enqueue is authorized, fixed, and deduplicated", async () => {
  const rows = new Map<string, EmailOutbox>();
  const businessSnapshot = { users: 4, reviews: 11, events: 3 };
  const outbox = {
    async enqueue(input: {
      type: "controlled_delivery_test";
      recipientEmail: string;
      payload: Record<string, never>;
      deduplicationKey: string;
      scheduledFor: Date;
      expiresAt: Date;
      maxAttempts: number;
    }) {
      const existing = rows.get(input.deduplicationKey);
      if (existing) return { created: false, row: existing };
      const row = controlledRow({
        id: rows.size + 1,
        type: input.type,
        recipientEmail: input.recipientEmail,
        payload: input.payload,
        deduplicationKey: input.deduplicationKey,
        scheduledFor: input.scheduledFor,
        nextAttemptAt: input.scheduledFor,
        expiresAt: input.expiresAt,
        maxAttempts: input.maxAttempts,
      });
      rows.set(input.deduplicationKey, row);
      return { created: true, row };
    },
  };

  const first = await enqueueControlledDeliveryTest({
    outbox,
    policy: controlledPolicy(),
    recipientEmail: " AUTHORIZED@EXAMPLE.TEST ",
    runId: "run-001",
    now,
  });
  const duplicate = await enqueueControlledDeliveryTest({
    outbox,
    policy: controlledPolicy(),
    recipientEmail: authorizedRecipient,
    runId: "run-001",
    now,
  });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(rows.size, 1);
  assert.equal(first.row.type, "controlled_delivery_test");
  assert.deepEqual(first.row.payload, {});
  assert.deepEqual(businessSnapshot, { users: 4, reviews: 11, events: 3 });

  await assert.rejects(
    enqueueControlledDeliveryTest({
      outbox,
      policy: controlledPolicy(),
      recipientEmail: "other@example.test",
      runId: "run-002",
      now,
    }),
    /not authorized/,
  );
  assert.equal(rows.size, 1);
});

test("controlled runner processes exact row and leaves backlog untouched", async () => {
  const target = controlledRow();
  const unrelatedPending = controlledRow({
    id: 101,
    type: "account_approved",
    recipientEmail: "other@example.test",
    payload: { firstName: "Other" },
    deduplicationKey: "account-approved:101",
  });
  const unrelatedRetry = controlledRow({
    id: 102,
    recipientEmail: "other@example.test",
    deduplicationKey: "controlled-delivery-test:other",
    status: "retry_wait",
  });
  const outbox = new ControlledMemoryOutbox([
    target,
    unrelatedPending,
    unrelatedRetry,
  ]);
  const provider = new FakeEmailProvider();
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "controlled-worker",
    now: () => now,
    policy: controlledPolicy(),
    replyTo: "support@example.test",
  });

  assert.deepEqual(await worker.runOnce(), {
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
  });
  assert.equal(outbox.broadClaimCalls, 0);
  assert.deepEqual(await worker.runExactOnce(target.id), {
    claimed: 1,
    sent: 1,
    retrying: 0,
    failed: 0,
    skipped: 0,
  });
  assert.equal(target.status, "sent");
  assert.equal(target.providerMessageId, "fake-message-1");
  assert.equal(unrelatedPending.status, "pending");
  assert.equal(unrelatedRetry.status, "retry_wait");
  assert.equal(provider.sentMessages.length, 1);
  assert.equal(provider.sentMessages[0].to, authorizedRecipient);
  assert.equal(provider.sentMessages[0].replyTo, "support@example.test");
});

test("worker logs never expose provider message IDs", async () => {
  const target = controlledRow();
  const outbox = new ControlledMemoryOutbox([target]);
  const provider = {
    configurationFailure: () => null,
    send: async () => ({
      outcome: "success" as const,
      providerMessageId: "unsafe\nsecret=provider-value",
    }),
  };
  const contexts: unknown[] = [];
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "controlled-worker",
    now: () => now,
    policy: controlledPolicy(),
    log: {
      info: (_message, context) => contexts.push(context),
      warn: (_message, context) => contexts.push(context),
      error: (_message, context) => contexts.push(context),
    },
  });

  assert.equal((await worker.runExactOnce(target.id)).sent, 1);
  const serialized = JSON.stringify(contexts);
  assert.doesNotMatch(serialized, /provider-value|unsafe/);
  assert.match(serialized, /\[REDACTED\]/);
});

test("controlled runner blocks missing, wrong type, recipient, status, and expiry", async () => {
  const cases = [
    controlledRow({ id: 201, type: "account_approved" }),
    controlledRow({ id: 202, recipientEmail: "other@example.test" }),
    controlledRow({ id: 203, status: "sent" }),
    controlledRow({ id: 204, expiresAt: new Date(now.getTime() - 1) }),
    controlledRow({ id: 205, deduplicationKey: "wrong-prefix" }),
  ];
  const outbox = new ControlledMemoryOutbox(cases);
  const provider = new FakeEmailProvider();
  const worker = new EmailDeliveryWorker(outbox, provider, {
    workerId: "controlled-worker",
    now: () => now,
    policy: controlledPolicy(),
  });

  for (const row of cases) {
    assert.equal((await worker.runExactOnce(row.id)).sent, 0);
  }
  assert.equal((await worker.runExactOnce(999)).sent, 0);
  assert.equal(provider.sentMessages.length, 0);
  assert.equal(cases[0].status, "pending");
  assert.equal(cases[1].status, "pending");
});

test("concurrent exact claims produce one owner and fencing rejects stale token", async () => {
  const row = controlledRow({ id: 301 });
  const outbox = new ControlledMemoryOutbox([row]);
  const options = {
    id: row.id,
    expectedType: row.type,
    expectedRecipientEmail: row.recipientEmail,
    expectedDeduplicationKey: row.deduplicationKey,
    now,
  };
  const [first, second] = await Promise.all([
    outbox.claimExactMessage({ ...options, workerId: "worker-a" }),
    outbox.claimExactMessage({ ...options, workerId: "worker-b" }),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(await outbox.markSent(row.id, "wrong", "stale-token", now), false);
  assert.equal(row.status, "processing");
  assert.equal(
    await outbox.markSent(row.id, "accepted", row.claimToken!, now),
    true,
  );
  assert.equal(row.status, "sent");
});

test("one-shot transient and permanent failures follow bounded status semantics", async () => {
  const retryRow = controlledRow({ id: 401 });
  const retryOutbox = new ControlledMemoryOutbox([retryRow]);
  const retryProvider = new FakeEmailProvider();
  retryProvider.queueOutcome("transient_failure");
  const retryWorker = new EmailDeliveryWorker(retryOutbox, retryProvider, {
    workerId: "retry-worker",
    now: () => now,
    policy: controlledPolicy(),
  });
  assert.equal((await retryWorker.runExactOnce(retryRow.id)).retrying, 1);
  assert.equal(retryRow.status, "retry_wait");
  assert.equal(retryProvider.sentMessages.length, 0);

  const failedRow = controlledRow({ id: 402 });
  const failedOutbox = new ControlledMemoryOutbox([failedRow]);
  const failedProvider = new FakeEmailProvider();
  failedProvider.queueOutcome("permanent_failure");
  const failedWorker = new EmailDeliveryWorker(failedOutbox, failedProvider, {
    workerId: "failed-worker",
    now: () => now,
    policy: controlledPolicy(),
  });
  assert.equal((await failedWorker.runExactOnce(failedRow.id)).failed, 1);
  assert.equal(failedRow.status, "failed");
  assert.equal(failedProvider.sentMessages.length, 0);
});

test("controlled tooling is not exposed by public routes or application startup", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  const startup = readFileSync("server/index.ts", "utf8");
  const legacyEmail = readFileSync("server/auth/email.ts", "utf8");
  assert.doesNotMatch(routes, /controlled_delivery_test|runExactOnce|email:controlled/);
  assert.doesNotMatch(startup, /PostmarkEmailProvider|EmailDeliveryWorker|runExactOnce/);
  assert.doesNotMatch(startup, /controlled-email/);
  assert.doesNotMatch(legacyEmail, /nodemailer|createTransport|sendMail|verify\(/);
  assert.match(legacyEmail, /Legacy direct email delivery is disabled/);
});