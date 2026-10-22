import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import {
  emailOutbox,
  emailOutboxStatuses,
  emailOutboxTypes,
  type EmailOutbox,
} from "@shared/schema";
import {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  nextRetryAt,
} from "./retry";
import { parseTemplatePayload, type EmailTemplateType } from "./templates";
import {
  sanitizeProviderDiagnostic,
  sanitizeProviderErrorCode,
  type ProviderFailure,
} from "./provider";
import {
  UnconfiguredSensitiveEmailPayloadProtector,
  type SensitiveEmailPayloadProtector,
} from "./sensitive-payload";
import { isEventEmailEligible } from "./event-policy";
import * as schema from "@shared/schema";

type DatabaseExecutor = any;

export interface EnqueueEmailInput {
  type: EmailTemplateType;
  recipientUserId?: number | null;
  recipientEmail: string;
  payload: unknown;
  sensitivePayload?: Record<string, unknown>;
  deduplicationKey: string;
  scheduledFor?: Date;
  expiresAt?: Date | null;
  maxAttempts?: number;
}

export interface EnqueueEmailResult {
  created: boolean;
  row: EmailOutbox;
}

export interface RegistrationCancellationResult {
  cancelled: number;
  processing: number;
}

export interface ClaimOptions {
  limit?: number;
  workerId: string;
  now?: Date;
}

export interface ExactClaimOptions {
  id: number;
  workerId: string;
  expectedType?: string;
  expectedRecipientEmail?: string;
  expectedDeduplicationKey?: string;
  now?: Date;
}

function normalizeRecipientEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) {
    throw new Error("Invalid email recipient");
  }
  return normalized;
}

function ensureFiniteDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return value;
}

function ensureType(type: string): asserts type is EmailTemplateType {
  if (!emailOutboxTypes.includes(type as EmailTemplateType)) {
    throw new Error("Unsupported email type");
  }
}

function ensureStatus(status: string): asserts status is typeof emailOutboxStatuses[number] {
  if (!emailOutboxStatuses.includes(status as typeof emailOutboxStatuses[number])) {
    throw new Error("Unsupported email status");
  }
}

export function clearedEncryptedPayload() {
  return sql`CASE WHEN ${emailOutbox.type} = 'password_reset' THEN '' ELSE NULL END`;
}

export class EmailOutboxService {
  constructor(
    private readonly executor: DatabaseExecutor = db,
    private readonly sensitivePayloadProtector: SensitiveEmailPayloadProtector =
      new UnconfiguredSensitiveEmailPayloadProtector(),
  ) {}

  async isMessageEligible(row: EmailOutbox, now: Date): Promise<boolean> {
    if (row.type === "event_created" || row.type === "event_reminder") {
      return isEventEmailEligible(this.executor, row, now);
    }
    if (row.type === "evaluation_submitted" && row.payload.audience === "reviewer") {
      const [user] = await this.executor.select().from(schema.users)
        .where(eq(schema.users.id, row.recipientUserId || -1));
      if (!user?.isVerified || user.email.toLowerCase() !== row.recipientEmail) return false;
      const reviewId = Number(row.deduplicationKey.split(":")[1]);
      const [context] = await this.executor.select({ region: schema.events.region })
        .from(schema.reviews)
        .innerJoin(schema.events, eq(schema.events.id, schema.reviews.eventId))
        .where(eq(schema.reviews.id, reviewId));
      return !!context && (user.role === "admin" ||
        (user.userType === "Regional Supervisor" && !!context.region && user.region === context.region));
    }
    return true;
  }

  async cancelClaim(id: number, claimToken: string, now: Date): Promise<boolean> {
    const rows = await this.executor.update(emailOutbox).set({
      status: "cancelled", claimedAt: null, claimedBy: null, claimToken: null,
      lastErrorCode: "RECIPIENT_INELIGIBLE", lastError: "Notification no longer eligible",
      updatedAt: now,
    }).where(and(eq(emailOutbox.id, id), eq(emailOutbox.status, "processing"),
      eq(emailOutbox.claimToken, claimToken))).returning({ id: emailOutbox.id });
    return rows.length === 1;
  }

  withExecutor(executor: DatabaseExecutor): EmailOutboxService {
    return new EmailOutboxService(executor, this.sensitivePayloadProtector);
  }

  async enqueue(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
    ensureType(input.type);
    if (input.type === "password_reset" && !input.sensitivePayload) {
      throw new Error("Password reset email requires a sensitive payload");
    }
    if (input.type !== "password_reset" && input.sensitivePayload) {
      throw new Error("Sensitive payload is only supported for password reset");
    }
    const recipientEmail = normalizeRecipientEmail(input.recipientEmail);
    const deduplicationKey = input.deduplicationKey.trim();
    if (!deduplicationKey || deduplicationKey.length > 500) {
      throw new Error("A bounded deduplication key is required");
    }

    const passwordResetPayload = input.type === "password_reset"
      ? parseTemplatePayload("password_reset", {
          ...(input.payload as Record<string, unknown>),
          ...input.sensitivePayload,
        })
      : null;
    const payload = input.type === "password_reset"
      ? { expiresInMinutes: passwordResetPayload!.expiresInMinutes }
      : parseTemplatePayload(input.type, input.payload);
    const sensitivePayload = input.type === "password_reset"
      ? { resetUrl: passwordResetPayload!.resetUrl }
      : undefined;
    const encryptedPayload = input.type === "password_reset"
      ? await this.sensitivePayloadProtector.seal(
          input.type,
          sensitivePayload!,
        )
      : null;
    const scheduledFor = ensureFiniteDate(input.scheduledFor ?? new Date(), "scheduledFor");
    const expiresAt = input.expiresAt === undefined || input.expiresAt === null
      ? null
      : ensureFiniteDate(input.expiresAt, "expiresAt");
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      throw new Error("maxAttempts must be an integer between 1 and 20");
    }

    const inserted = await this.executor
      .insert(emailOutbox)
      .values({
        type: input.type,
        recipientUserId: input.recipientUserId ?? null,
        recipientEmail,
        payload: payload as Record<string, unknown>,
        encryptedPayload,
        deduplicationKey,
        status: "pending",
        scheduledFor,
        nextAttemptAt: scheduledFor,
        attemptCount: 0,
        maxAttempts,
        expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: emailOutbox.deduplicationKey })
      .returning();

    if (inserted[0]) {
      return { created: true, row: inserted[0] };
    }

    const [existing] = await this.executor
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.deduplicationKey, deduplicationKey))
      .limit(1);
    if (!existing) {
      throw new Error("Email deduplication conflict could not be resolved");
    }
    return { created: false, row: existing };
  }

  async getById(id: number): Promise<EmailOutbox | undefined> {
    const [row] = await this.executor
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, id))
      .limit(1);
    return row;
  }

  async cancelObsoleteRegistrationMessages(
    recipientUserId: number,
    now = new Date(),
  ): Promise<RegistrationCancellationResult> {
    const activeRows = await this.executor
      .select({
        id: emailOutbox.id,
        status: emailOutbox.status,
      })
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.recipientUserId, recipientUserId),
          eq(emailOutbox.type, "registration_received"),
          inArray(emailOutbox.status, ["pending", "retry_wait", "processing"]),
        ),
      )
      .for("update");

    const processing = activeRows.filter(
      (row: Pick<EmailOutbox, "status">) => row.status === "processing",
    ).length;
    if (processing > 0) {
      return { cancelled: 0, processing };
    }

    const cancellableIds = activeRows
      .filter(
        (row: Pick<EmailOutbox, "id" | "status">) =>
          row.status === "pending" || row.status === "retry_wait",
      )
      .map((row: Pick<EmailOutbox, "id">) => row.id);
    if (cancellableIds.length === 0) {
      return { cancelled: 0, processing: 0 };
    }

    const cancelled = await this.executor
      .update(emailOutbox)
      .set({
        status: "cancelled",
        lastErrorCode: "ACCOUNT_REJECTED",
        lastError: "Registration email cancelled because the account was rejected",
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload: null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(emailOutbox.id, cancellableIds),
          inArray(emailOutbox.status, ["pending", "retry_wait"]),
        ),
      )
      .returning({ id: emailOutbox.id });
    return { cancelled: cancelled.length, processing: 0 };
  }

  async cancelExpiredMessages(now = new Date()): Promise<number> {
    const cancelled = await this.executor
      .update(emailOutbox)
      .set({
        status: "cancelled",
        lastErrorCode: "EXPIRED",
        lastError: "Message expired before delivery",
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload: clearedEncryptedPayload(),
        updatedAt: now,
      })
      .where(
        and(
          inArray(emailOutbox.status, ["pending", "retry_wait"]),
          isNotNull(emailOutbox.expiresAt),
          lte(emailOutbox.expiresAt, now),
        ),
      )
      .returning({ id: emailOutbox.id });
    return cancelled.length;
  }

  async recoverStaleClaims(
    now = new Date(),
    leaseMs = DEFAULT_LEASE_MS,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - leaseMs);
    const expired = await this.executor
      .update(emailOutbox)
      .set({
        status: "cancelled",
        lastErrorCode: "EXPIRED",
        lastError: "Processing lease expired after message expiration",
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload: clearedEncryptedPayload(),
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.status, "processing"),
          isNotNull(emailOutbox.claimedAt),
          lt(emailOutbox.claimedAt, cutoff),
          isNotNull(emailOutbox.expiresAt),
          lte(emailOutbox.expiresAt, now),
        ),
      )
      .returning({ id: emailOutbox.id });

    const recovered = await this.executor
      .update(emailOutbox)
      .set({
        status: "retry_wait",
        nextAttemptAt: now,
        attemptCount: sql`${emailOutbox.attemptCount} + 1`,
        lastErrorCode: "STALE_CLAIM",
        lastError: "Processing lease recovered",
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.status, "processing"),
          isNotNull(emailOutbox.claimedAt),
          lt(emailOutbox.claimedAt, cutoff),
          lt(
            emailOutbox.attemptCount,
            sql`${emailOutbox.maxAttempts} - 1`,
          ),
          or(isNull(emailOutbox.expiresAt), gt(emailOutbox.expiresAt, now)),
        ),
      )
      .returning({ id: emailOutbox.id });

    const exhausted = await this.executor
      .update(emailOutbox)
      .set({
        status: "failed",
        nextAttemptAt: now,
        attemptCount: sql`${emailOutbox.attemptCount} + 1`,
        lastErrorCode: "STALE_CLAIM_LIMIT",
        lastError: "Processing lease recovery limit reached",
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload: clearedEncryptedPayload(),
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.status, "processing"),
          isNotNull(emailOutbox.claimedAt),
          lt(emailOutbox.claimedAt, cutoff),
          gte(
            emailOutbox.attemptCount,
            sql`${emailOutbox.maxAttempts} - 1`,
          ),
          or(isNull(emailOutbox.expiresAt), gt(emailOutbox.expiresAt, now)),
        ),
      )
      .returning({ id: emailOutbox.id });
    return expired.length + recovered.length + exhausted.length;
  }

  async claimDueMessages(options: ClaimOptions): Promise<EmailOutbox[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
    const now = options.now ?? new Date();
    const claimToken = randomUUID();
    return this.executor.transaction(async (tx: DatabaseExecutor) => {
      const dueRows = await tx
        .select()
        .from(emailOutbox)
        .where(
          and(
            inArray(emailOutbox.status, ["pending", "retry_wait"]),
            lte(emailOutbox.scheduledFor, now),
            lte(emailOutbox.nextAttemptAt, now),
            lt(emailOutbox.attemptCount, emailOutbox.maxAttempts),
            or(isNull(emailOutbox.expiresAt), gt(emailOutbox.expiresAt, now)),
          ),
        )
        .orderBy(asc(emailOutbox.scheduledFor), asc(emailOutbox.id))
        .limit(limit)
        .for("update", { skipLocked: true });

      if (dueRows.length === 0) {
        return [];
      }

      const ids = dueRows.map((row: EmailOutbox) => row.id);
      return tx
        .update(emailOutbox)
        .set({
          status: "processing",
          claimedAt: now,
          claimedBy: options.workerId,
          claimToken,
          updatedAt: now,
        })
        .where(
          and(
            inArray(emailOutbox.id, ids),
            inArray(emailOutbox.status, ["pending", "retry_wait"]),
          ),
        )
        .returning();
    });
  }

  async claimExactMessage(options: ExactClaimOptions): Promise<EmailOutbox | undefined> {
    const now = options.now ?? new Date();
    const claimToken = randomUUID();
    return this.executor.transaction(async (tx: DatabaseExecutor) => {
      const [row] = await tx
        .select()
        .from(emailOutbox)
        .where(
          and(
            eq(emailOutbox.id, options.id),
            inArray(emailOutbox.status, ["pending", "retry_wait"]),
            lte(emailOutbox.scheduledFor, now),
            lte(emailOutbox.nextAttemptAt, now),
            lt(emailOutbox.attemptCount, emailOutbox.maxAttempts),
            or(isNull(emailOutbox.expiresAt), gt(emailOutbox.expiresAt, now)),
            options.expectedType
              ? eq(emailOutbox.type, options.expectedType)
              : undefined,
            options.expectedRecipientEmail
              ? eq(emailOutbox.recipientEmail, options.expectedRecipientEmail)
              : undefined,
            options.expectedDeduplicationKey
              ? eq(emailOutbox.deduplicationKey, options.expectedDeduplicationKey)
              : undefined,
          ),
        )
        .for("update")
        .limit(1);

      if (!row) {
        return undefined;
      }

      const [claimed] = await tx
        .update(emailOutbox)
        .set({
          status: "processing",
          claimedAt: now,
          claimedBy: options.workerId,
          claimToken,
          updatedAt: now,
        })
        .where(
          and(
            eq(emailOutbox.id, options.id),
            inArray(emailOutbox.status, ["pending", "retry_wait"]),
          ),
        )
        .returning();
      return claimed;
    });
  }

  async markSent(
    id: number,
    providerMessageId: string | undefined,
    claimToken: string,
    now = new Date(),
  ): Promise<boolean> {
    const updated = await this.executor
      .update(emailOutbox)
      .set({
        status: "sent",
        attemptCount: sql`${emailOutbox.attemptCount} + 1`,
        providerMessageId: providerMessageId ?? null,
        sentAt: now,
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload: clearedEncryptedPayload(),
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.claimToken, claimToken),
          or(isNull(emailOutbox.expiresAt), gt(emailOutbox.expiresAt, now)),
        ),
      )
      .returning({ id: emailOutbox.id });
    return updated.length > 0;
  }

  async markTransientFailure(
    id: number,
    failure: ProviderFailure,
    claimToken: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.markFailure(id, failure, false, claimToken, now);
  }

  async markPermanentFailure(
    id: number,
    failure: ProviderFailure,
    claimToken: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.markFailure(id, failure, true, claimToken, now);
  }

  private async markFailure(
    id: number,
    failure: ProviderFailure,
    permanent: boolean,
    claimToken: string,
    now: Date,
  ): Promise<boolean> {
    const [row] = await this.executor
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.claimToken, claimToken),
        ),
      )
      .limit(1);
    if (!row) {
      return false;
    }
    ensureStatus(row.status);

    const attemptCount = row.attemptCount + 1;
    const expired = row.expiresAt !== null && row.expiresAt <= now;
    const exhausted = attemptCount >= row.maxAttempts;
    const terminal = permanent || expired || exhausted;
    const retryAt = nextRetryAt(now, attemptCount);
    const retryWouldExpire = row.expiresAt !== null && row.expiresAt <= retryAt;
    const cancelledForExpiry = expired || retryWouldExpire;

    const updated = await this.executor
      .update(emailOutbox)
      .set({
        status: cancelledForExpiry
          ? "cancelled"
          : terminal
            ? "failed"
            : "retry_wait",
        nextAttemptAt: terminal || cancelledForExpiry ? now : retryAt,
        attemptCount,
        lastErrorCode: expired
          ? "EXPIRED"
          : retryWouldExpire
            ? "EXPIRES_BEFORE_RETRY"
            : sanitizeProviderErrorCode(failure.errorCode),
        lastError: sanitizeProviderDiagnostic(failure.diagnostic),
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload:
          terminal || cancelledForExpiry
            ? row.type === "password_reset" ? "" : null
            : row.encryptedPayload,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.claimToken, claimToken),
        ),
      )
      .returning({ id: emailOutbox.id });
    return updated.length > 0;
  }

  async cancelUnsentMessage(id: number, now = new Date()): Promise<boolean> {
    const cancelled = await this.executor
      .update(emailOutbox)
      .set({
        status: "cancelled",
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload: clearedEncryptedPayload(),
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.id, id),
          inArray(emailOutbox.status, ["pending", "retry_wait"]),
        ),
      )
      .returning({ id: emailOutbox.id });
    return cancelled.length > 0;
  }

  async cancelExpiredClaim(
    id: number,
    claimToken: string,
    now = new Date(),
  ): Promise<boolean> {
    const cancelled = await this.executor
      .update(emailOutbox)
      .set({
        status: "cancelled",
        lastErrorCode: "EXPIRED",
        lastError: "Message expired before provider call",
        claimedAt: null,
        claimedBy: null,
        claimToken: null,
        encryptedPayload: clearedEncryptedPayload(),
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.claimToken, claimToken),
        ),
      )
      .returning({ id: emailOutbox.id });
    return cancelled.length > 0;
  }

  async renewClaim(
    id: number,
    claimToken: string,
    now = new Date(),
  ): Promise<boolean> {
    const renewed = await this.executor
      .update(emailOutbox)
      .set({
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailOutbox.id, id),
          eq(emailOutbox.status, "processing"),
          eq(emailOutbox.claimToken, claimToken),
          or(isNull(emailOutbox.expiresAt), gt(emailOutbox.expiresAt, now)),
        ),
      )
      .returning({ id: emailOutbox.id });
    return renewed.length > 0;
  }
}

export const emailOutboxService = new EmailOutboxService();
