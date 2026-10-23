import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { EmailOutboxService } from "../email/outbox";
import {
  UnconfiguredSensitiveEmailPayloadProtector,
  type SensitiveEmailPayloadProtector,
} from "../email/sensitive-payload";

type DatabaseExecutor = any;

export const PASSWORD_RESET_TOKEN_BYTES = 32;
export const PASSWORD_RESET_TTL_MINUTES = 30;
export const PASSWORD_BCRYPT_COST = 10;
export const INVALID_RESET_MESSAGE = "This password reset link is invalid or has expired";

export class InvalidPasswordResetError extends Error {
  readonly statusCode = 400;

  constructor() {
    super(INVALID_RESET_MESSAGE);
    this.name = "InvalidPasswordResetError";
  }
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildTrustedResetUrl(baseUrl: string, token: string): string {
  let trusted: URL;
  try {
    trusted = new URL(baseUrl);
  } catch {
    throw new Error("APP_URL must be a valid absolute URL");
  }
  if (
    !["http:", "https:"].includes(trusted.protocol) ||
    trusted.username ||
    trusted.password
  ) {
    throw new Error("APP_URL must be a trusted HTTP(S) URL without credentials");
  }
  const resetUrl = new URL("/reset-password", trusted);
  resetUrl.searchParams.set("token", token);
  return resetUrl.toString();
}

export class PasswordResetService {
  constructor(
    private readonly executor: DatabaseExecutor = db,
    private readonly sensitivePayloadProtector: SensitiveEmailPayloadProtector =
      new UnconfiguredSensitiveEmailPayloadProtector(),
    private readonly trustedAppUrl = "",
    private readonly generateToken = () =>
      randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url"),
  ) {}

  async requestReset(
    email: string,
    now = new Date(),
  ): Promise<{ issued: boolean; token?: string; resetRequestId?: number }> {
    const normalizedEmail = email.trim().toLowerCase();
    const token = this.generateToken();
    const tokenHash = hashPasswordResetToken(token);
    const expiresAt = new Date(
      now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000,
    );

    return this.executor.transaction(async (tx: DatabaseExecutor) => {
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, normalizedEmail))
        .for("update")
        .limit(1);
      if (!user) {
        return { issued: false };
      }

      const activeTokens = await tx
        .select({ id: schema.passwordResetTokens.id })
        .from(schema.passwordResetTokens)
        .where(
          and(
            eq(schema.passwordResetTokens.userId, user.id),
            isNull(schema.passwordResetTokens.usedAt),
            isNull(schema.passwordResetTokens.revokedAt),
            gt(schema.passwordResetTokens.expiresAt, now),
          ),
        )
        .for("update");

      if (activeTokens.length > 0) {
        await tx
          .update(schema.passwordResetTokens)
          .set({ revokedAt: now })
          .where(
            inArray(
              schema.passwordResetTokens.id,
              activeTokens.map(({ id }: { id: number }) => id),
            ),
          );
      }

      const outbox = new EmailOutboxService(
        tx,
        this.sensitivePayloadProtector,
      );
      for (const activeToken of activeTokens) {
        const [priorMessage] = await tx
          .select({ id: schema.emailOutbox.id })
          .from(schema.emailOutbox)
          .where(
            eq(
              schema.emailOutbox.deduplicationKey,
              `password-reset:${activeToken.id}`,
            ),
          )
          .limit(1);
        if (priorMessage) {
          await outbox.cancelUnsentMessage(priorMessage.id, now);
        }
      }

      const [resetRequest] = await tx
        .insert(schema.passwordResetTokens)
        .values({
          userId: user.id,
          tokenHash,
          createdAt: now,
          expiresAt,
        })
        .returning({ id: schema.passwordResetTokens.id });

      const resetUrl = buildTrustedResetUrl(this.trustedAppUrl, token);
      await outbox.enqueue({
        type: "password_reset",
        recipientUserId: user.id,
        recipientEmail: user.email,
        payload: {
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        },
        sensitivePayload: { resetUrl },
        deduplicationKey: `password-reset:${resetRequest.id}`,
        scheduledFor: now,
        expiresAt,
      });

      return {
        issued: true,
        token,
        resetRequestId: resetRequest.id,
      };
    });
  }

  async resetPassword(
    token: string,
    newPassword: string,
    now = new Date(),
  ): Promise<void> {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      newPassword.length < 8 ||
      newPassword.length > 100
    ) {
      throw new InvalidPasswordResetError();
    }
    const tokenHash = hashPasswordResetToken(token);
    const password = await bcrypt.hash(newPassword, PASSWORD_BCRYPT_COST);

    await this.executor.transaction(async (tx: DatabaseExecutor) => {
      // Match requestReset's lock order: user first, then token. This prevents
      // reset-vs-request deadlocks across concurrent instances.
      const [candidate] = await tx.select({ userId: schema.passwordResetTokens.userId })
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.tokenHash, tokenHash));
      if (!candidate) throw new InvalidPasswordResetError();
      await tx.select({ id: schema.users.id }).from(schema.users)
        .where(eq(schema.users.id, candidate.userId)).for("update");
      const [resetRequest] = await tx
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
        .for("update");
      if (
        !resetRequest ||
        resetRequest.usedAt ||
        resetRequest.revokedAt ||
        resetRequest.expiresAt <= now
      ) {
        throw new InvalidPasswordResetError();
      }

      const [updatedUser] = await tx
        .update(schema.users)
        .set({
          password,
          sessionVersion: sql`${schema.users.sessionVersion} + 1`,
        })
        .where(eq(schema.users.id, resetRequest.userId))
        .returning({ id: schema.users.id });
      if (!updatedUser) {
        throw new InvalidPasswordResetError();
      }

      await tx
        .update(schema.passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(schema.passwordResetTokens.id, resetRequest.id));

      const siblingTokens = await tx
        .select({ id: schema.passwordResetTokens.id })
        .from(schema.passwordResetTokens)
        .where(
          and(
            eq(schema.passwordResetTokens.userId, resetRequest.userId),
            ne(schema.passwordResetTokens.id, resetRequest.id),
            isNull(schema.passwordResetTokens.usedAt),
            isNull(schema.passwordResetTokens.revokedAt),
          ),
        )
        .for("update");
      if (siblingTokens.length > 0) {
        await tx
          .update(schema.passwordResetTokens)
          .set({ revokedAt: now })
          .where(
            inArray(
              schema.passwordResetTokens.id,
              siblingTokens.map(({ id }: { id: number }) => id),
            ),
          );
      }

      const outbox = new EmailOutboxService(
        tx,
        this.sensitivePayloadProtector,
      );
      const tokenIds = [resetRequest.id, ...siblingTokens.map(({ id }: { id: number }) => id)];
      for (const tokenId of tokenIds) {
        const [message] = await tx
          .select({ id: schema.emailOutbox.id })
          .from(schema.emailOutbox)
          .where(
            eq(
              schema.emailOutbox.deduplicationKey,
              `password-reset:${tokenId}`,
            ),
          )
          .limit(1);
        if (message) {
          await outbox.cancelUnsentMessage(message.id, now);
        }
      }
    });
  }
}

interface RateBucket {
  timestamps: number[];
}

export class PasswordResetRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxBuckets = 10_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    if (!this.buckets.has(key) && this.buckets.size >= this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) {
        this.buckets.delete(oldestKey);
      }
    }
    const cutoff = now - this.windowMs;
    const timestamps = (this.buckets.get(key)?.timestamps ?? [])
      .filter((timestamp) => timestamp > cutoff);
    if (timestamps.length >= this.limit) {
      this.buckets.set(key, { timestamps });
      return false;
    }
    timestamps.push(now);
    this.buckets.delete(key);
    this.buckets.set(key, { timestamps });
    return true;
  }
}