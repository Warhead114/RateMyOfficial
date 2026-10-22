import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";

export class DatabasePasswordResetRateLimiter {
  constructor(private readonly executor: any = db, private readonly namespace = "password-reset") {}

  async allow(scope: "ip" | "email" | "reset-ip", value: string, limit: number,
    windowMs: number, now = new Date()): Promise<boolean> {
    const key = `${this.namespace}:${createHash("sha256").update(`${scope}:${value}`).digest("hex")}`;
    const expires = new Date(now.getTime() + windowMs);
    const result = await this.executor.execute(sql`
      INSERT INTO password_reset_rate_limits (key_hash, attempts, expires_at)
      VALUES (${key}, 1, ${expires})
      ON CONFLICT (key_hash) DO UPDATE SET
        attempts = CASE WHEN password_reset_rate_limits.expires_at <= ${now}
          THEN 1 ELSE password_reset_rate_limits.attempts + 1 END,
        expires_at = CASE WHEN password_reset_rate_limits.expires_at <= ${now}
          THEN ${expires} ELSE password_reset_rate_limits.expires_at END
      WHERE password_reset_rate_limits.expires_at <= ${now}
         OR password_reset_rate_limits.attempts < ${limit}
      RETURNING key_hash`);
    // Bounded housekeeping, with no timer or raw identifying information.
    await this.executor.execute(sql`
      DELETE FROM password_reset_rate_limits WHERE key_hash IN (
        SELECT key_hash FROM password_reset_rate_limits
        WHERE expires_at < ${new Date(now.getTime() - 86_400_000)} LIMIT 100
      )`);
    return result.rows.length === 1;
  }
}
