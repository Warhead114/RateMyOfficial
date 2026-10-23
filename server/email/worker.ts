import { logger } from "../logger";
import type { EmailOutbox } from "@shared/schema";
import { ScopedValidationPolicy } from "./validation/scoped-policy";
import { renderOutboxMessage } from "./render-outbox";
import {
  sanitizeProviderErrorCode,
  type EmailMessage,
  type EmailProvider,
  type ProviderFailure,
} from "./provider";
import { providerFailure, DEFAULT_LEASE_MS } from "./retry";
import {
  UnconfiguredSensitiveEmailPayloadProtector,
  type SensitiveEmailPayloadProtector,
} from "./sensitive-payload";
import {
  createEmailDeliveryPolicyFromEnv,
  type EmailDeliveryPolicy,
} from "./policy";

export interface EmailWorkerOutbox {
  isMessageEligible?(row: EmailOutbox, now: Date): Promise<boolean>;
  cancelClaim?(id: number, claimToken: string, now: Date): Promise<boolean>;
  getById(id: number): Promise<EmailOutbox | undefined>;
  recoverStaleClaims(now: Date, leaseMs?: number): Promise<number>;
  cancelExpiredMessages(now: Date): Promise<number>;
  claimDueMessages(options: {
    limit: number;
    workerId: string;
    now: Date;
  }): Promise<EmailOutbox[]>;
  claimExactMessage(options: {
    id: number;
    workerId: string;
    expectedType: string;
    expectedRecipientEmail: string;
    expectedDeduplicationKey: string;
    now: Date;
  }): Promise<EmailOutbox | undefined>;
  cancelExpiredClaim(id: number, claimToken: string, now: Date): Promise<boolean>;
  renewClaim(id: number, claimToken: string, now: Date): Promise<boolean>;
  markSent(id: number, providerMessageId: string | undefined, claimToken: string, now: Date): Promise<boolean>;
  markTransientFailure(id: number, failure: ProviderFailure, claimToken: string, now: Date): Promise<boolean>;
  markPermanentFailure(id: number, failure: ProviderFailure, claimToken: string, now: Date): Promise<boolean>;
}

export interface EmailDeliveryWorkerOptions {
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  now?: () => Date;
  log?: Pick<typeof logger, "info" | "warn" | "error">;
  sensitivePayloadProtector?: SensitiveEmailPayloadProtector;
  policy?: EmailDeliveryPolicy;
  replyTo?: string | null;
}

export interface EmailWorkerRunResult {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
}

function failureFromUnknown(error: unknown): ProviderFailure {
  return providerFailure(
    "PROVIDER_EXCEPTION",
    error instanceof Error ? error.message : "Email provider failed",
  );
}

export class EmailDeliveryWorker {
  private readonly options: Required<EmailDeliveryWorkerOptions>;
  private readonly sensitivePayloadProtector: SensitiveEmailPayloadProtector;

  constructor(
    private readonly outbox: EmailWorkerOutbox,
    private readonly provider: EmailProvider,
    options: EmailDeliveryWorkerOptions,
  ) {
    this.sensitivePayloadProtector =
      options.sensitivePayloadProtector ??
      new UnconfiguredSensitiveEmailPayloadProtector();
    this.options = {
      batchSize: 25,
      leaseMs: DEFAULT_LEASE_MS,
      now: () => new Date(),
      log: logger,
      sensitivePayloadProtector: this.sensitivePayloadProtector,
      policy: createEmailDeliveryPolicyFromEnv(),
      replyTo: null,
      ...options,
    };
  }

  async runOnce(): Promise<EmailWorkerRunResult> {
    if (!this.options.policy.canClaimBroadQueue()) {
      this.options.log.warn("Email broad queue processing blocked by delivery policy", {
        deliveryMode: this.options.policy.mode,
      });
      return this.emptyResult();
    }
    const configurationFailure = this.provider.configurationFailure?.();
    if (configurationFailure) {
      this.options.log.warn("Email provider configuration blocked", {
        errorCode: configurationFailure.errorCode,
      });
      return this.emptyResult();
    }

    const now = this.options.now();
    await this.outbox.recoverStaleClaims(now, this.options.leaseMs);
    await this.outbox.cancelExpiredMessages(now);
    const rows = await this.outbox.claimDueMessages({
      limit: this.options.batchSize,
      workerId: this.options.workerId,
      now,
    });

    const result: EmailWorkerRunResult = {
      claimed: rows.length,
      sent: 0,
      retrying: 0,
      failed: 0,
      skipped: 0,
    };

    const outcomes = await Promise.all(rows.map((row) => this.deliverRow(row)));
    for (const outcome of outcomes) {
      result[outcome] += 1;
    }

    return result;
  }

  async runExactOnce(outboxId: number): Promise<EmailWorkerRunResult> {
    if (!Number.isInteger(outboxId) || outboxId < 1) {
      return { ...this.emptyResult(), skipped: 1 };
    }

    const configurationFailure = this.provider.configurationFailure?.();
    if (configurationFailure) {
      this.options.log.warn("Controlled email provider configuration blocked", {
        errorCode: configurationFailure.errorCode,
      });
      return { ...this.emptyResult(), skipped: 1 };
    }

    const row = await this.outbox.getById(outboxId);
    if (!row) {
      return { ...this.emptyResult(), skipped: 1 };
    }
    const authorization = this.options.policy.authorizeControlledRow(row);
    if (
      !authorization.allowed ||
      !/^controlled-delivery-test:[a-z0-9][a-z0-9._:-]{0,199}$/i.test(
        row.deduplicationKey,
      )
    ) {
      this.options.log.warn("Controlled email row blocked", {
        outboxId,
        deliveryMode: this.options.policy.mode,
      });
      return { ...this.emptyResult(), skipped: 1 };
    }

    const now = this.options.now();
    const claimed = await this.outbox.claimExactMessage({
      id: row.id,
      workerId: this.options.workerId,
      expectedType: row.type,
      expectedRecipientEmail: row.recipientEmail,
      expectedDeduplicationKey: row.deduplicationKey,
      now,
    });
    if (!claimed) {
      return { ...this.emptyResult(), skipped: 1 };
    }

    const result = this.emptyResult();
    result.claimed = 1;
    const outcome = await this.deliverRow(claimed);
    result[outcome] += 1;
    return result;
  }

  // Operator validation only: still uses exact claims, normal rendering,
  // encryption, eligibility and final claim fencing. Never drains a queue.
  async runScopedValidationOnce(outboxId: number): Promise<EmailWorkerRunResult> {
    if (!(this.options.policy instanceof ScopedValidationPolicy) ||
        this.options.policy.canClaimBroadQueue() || this.provider.configurationFailure?.()) {
      return { ...this.emptyResult(), skipped: 1 };
    }
    const row = await this.outbox.getById(outboxId);
    if (!row || !this.options.policy.authorizeControlledRow(row).allowed) {
      return { ...this.emptyResult(), skipped: 1 };
    }
    const claimed = await this.outbox.claimExactMessage({
      id: row.id, workerId: this.options.workerId, expectedType: row.type,
      expectedRecipientEmail: row.recipientEmail,
      expectedDeduplicationKey: row.deduplicationKey, now: this.options.now(),
    });
    if (!claimed) return { ...this.emptyResult(), skipped: 1 };
    const result = this.emptyResult();
    result.claimed = 1;
    result[await this.deliverRow(claimed)] += 1;
    return result;
  }

  private emptyResult(): EmailWorkerRunResult {
    return {
      claimed: 0,
      sent: 0,
      retrying: 0,
      failed: 0,
      skipped: 0,
    };
  }

  private async deliverRow(row: EmailOutbox): Promise<"sent" | "retrying" | "failed" | "skipped"> {
    const now = this.options.now();
    if (!row.claimToken) {
      this.options.log.warn("Email outbox claim token missing", {
        outboxId: row.id,
        emailType: row.type,
      });
      return "skipped";
    }

    if (row.expiresAt && row.expiresAt <= now) {
      await this.outbox.cancelExpiredClaim(row.id, row.claimToken, now);
      this.options.log.warn("Email outbox message expired", {
        outboxId: row.id,
        emailType: row.type,
      });
      return "skipped";
    }

    const renewed = await this.outbox.renewClaim(row.id, row.claimToken, now);
    if (!renewed) {
      this.options.log.warn("Email outbox claim ownership lost", {
        outboxId: row.id,
        emailType: row.type,
      });
      return "skipped";
    }

    if (row.type === "event_created" || row.type === "event_reminder" ||
          (row.type === "evaluation_submitted" && row.payload.audience === "reviewer")) {
      try {
        const eligible = await this.outbox.isMessageEligible?.(row, now);
        if (!eligible) {
          if (this.outbox.cancelClaim) await this.outbox.cancelClaim(row.id, row.claimToken, now);
          else await this.outbox.markPermanentFailure(row.id,
            providerFailure("RECIPIENT_INELIGIBLE", "Notification eligibility could not be established"),
            row.claimToken, now);
          return "skipped";
        }
      } catch {
        const marked = await this.outbox.markTransientFailure(row.id,
          providerFailure("ELIGIBILITY_CHECK_FAILED", "Notification eligibility temporarily unavailable"),
          row.claimToken, this.options.now());
        return marked ? "retrying" : "skipped";
      }
    }
    let message: EmailMessage;
    try {
      message = await renderOutboxMessage(row, this.sensitivePayloadProtector, this.options.replyTo);
    } catch (error) {
      const failure = providerFailure(
        "INVALID_TEMPLATE_PAYLOAD",
        error instanceof Error ? error.message : "Invalid template payload",
      );
      const marked = await this.outbox.markPermanentFailure(
        row.id,
        failure,
        row.claimToken,
        now,
      );
      this.options.log.error("Email outbox payload rejected", {
        outboxId: row.id,
        emailType: row.type,
        errorCode: failure.errorCode,
      });
      return marked ? "failed" : "skipped";
    }

    let providerResult;
    // Final claim fence after all asynchronous eligibility/rendering work.
    // A cancellation committed before this boundary must prevent provider use.
    if (!await this.outbox.renewClaim(row.id, row.claimToken, this.options.now())) {
      return "skipped";
    }
    try {
      providerResult = await this.provider.send(message);
    } catch (error) {
      providerResult = failureFromUnknown(error);
    }
    const completedAt = this.options.now();

    if (providerResult.outcome === "success") {
      const marked = await this.outbox.markSent(
        row.id,
        providerResult.providerMessageId,
        row.claimToken,
        completedAt,
      );
      if (!marked) {
        await this.outbox.cancelExpiredClaim(row.id, row.claimToken, completedAt);
        this.options.log.warn("Email outbox finalization lost claim ownership", {
          outboxId: row.id,
          emailType: row.type,
        });
        return "skipped";
      }
      this.options.log.info("Email outbox message sent", {
        outboxId: row.id,
        emailType: row.type,
        providerMessageId: providerResult.providerMessageId
          ? "[REDACTED]"
          : undefined,
      });
      return "sent";
    }

    if (providerResult.outcome === "transient_failure") {
      const marked = await this.outbox.markTransientFailure(
        row.id,
        providerResult,
        row.claimToken,
        completedAt,
      );
      this.options.log.warn("Email outbox message scheduled for retry", {
        outboxId: row.id,
        emailType: row.type,
        errorCode: sanitizeProviderErrorCode(providerResult.errorCode),
      });
      return marked ? "retrying" : "skipped";
    }

    const marked = await this.outbox.markPermanentFailure(
      row.id,
      providerResult,
      row.claimToken,
      completedAt,
    );
    this.options.log.error("Email outbox message permanently failed", {
      outboxId: row.id,
      emailType: row.type,
      errorCode: sanitizeProviderErrorCode(providerResult.errorCode),
    });
    return marked ? "failed" : "skipped";
  }
}
