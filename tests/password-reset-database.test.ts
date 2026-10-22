import assert from "node:assert/strict";
import { assertDevelopmentDatabase } from "./development-database-target";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { eq, inArray, like } from "drizzle-orm";
import * as schema from "../shared/schema";
import { db, pool } from "../server/db";
import { registerRoutes } from "../server/routes";
import { DatabasePasswordResetRateLimiter } from "../server/auth/password-reset-rate-limit";
import {
  hashPasswordResetToken,
  PasswordResetService,
} from "../server/auth/password-reset";
import { AesGcmSensitiveEmailPayloadProtector } from "../server/email/sensitive-payload";

const RUN_DATABASE_TESTS = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

test(
  "database-backed secure password reset workflow",
  { skip: RUN_DATABASE_TESTS ? false : "Run with npm run test:db" },
  async () => {
    await assertDevelopmentDatabase(pool);
    await pool.query("SELECT 1");
    const marker = `password-reset-${process.pid}-${Date.now()}`;
    const originalKey = process.env.EMAIL_SENSITIVE_PAYLOAD_KEY;
    const originalAppUrl = process.env.APP_URL;
    const key = Buffer.alloc(32, 41);
    process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = key.toString("base64");
    process.env.APP_URL = "https://trusted.example.test";
    const protector = new AesGcmSensitiveEmailPayloadProtector(key);
    const service = new PasswordResetService(
      db,
      protector,
      process.env.APP_URL,
    );
    const userIds: number[] = [];
    const tokenIds: number[] = [];
    let server: Awaited<ReturnType<typeof registerRoutes>> | undefined;

    const createUser = async (suffix: string) => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `${marker}-${suffix}@example.test`,
          password: await bcrypt.hash("OldPassword1!", 4),
          firstName: "Reset",
          lastName: suffix,
          role: "user",
          userType: "Coach",
          school: `${marker}-school`,
          yearsCoaching: 2,
          region: "East",
          isVerified: true,
        })
        .returning();
      userIds.push(user.id);
      return user;
    };

    try {
      const user = await createUser("primary");
      const unrelatedUser = await createUser("unrelated");
      const issuanceUser = await createUser("concurrent-issuance");

      const app = express();
      app.use(express.json());
      server = await registerRoutes(app, {
        passwordResetLimiter: new DatabasePasswordResetRateLimiter(db, marker),
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const request = async (
        path: string,
        options: RequestInit = {},
        cookie?: string,
      ) => {
        const headers = new Headers(options.headers);
        headers.set("content-type", "application/json");
        if (cookie) headers.set("cookie", cookie);
        return fetch(`${baseUrl}${path}`, { ...options, headers });
      };

      const login = async (email: string, password: string) => {
        const response = await request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        return {
          response,
          cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
        };
      };

      const primaryLogin = await login(user.email, "OldPassword1!");
      const unrelatedLogin = await login(unrelatedUser.email, "OldPassword1!");
      assert.equal(primaryLogin.response.status, 200);
      assert.ok(primaryLogin.cookie);
      assert.equal(unrelatedLogin.response.status, 200);
      assert.ok(unrelatedLogin.cookie);

      const unknownStartedAt = Date.now();
      const unknownResponse = await request("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: `${marker}-missing@example.test` }),
      });
      const unknownDuration = Date.now() - unknownStartedAt;
      const knownStartedAt = Date.now();
      const knownResponse = await request("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: `  ${user.email.toUpperCase()}  ` }),
      });
      const knownDuration = Date.now() - knownStartedAt;
      assert.equal(knownResponse.status, unknownResponse.status);
      assert.deepEqual(await knownResponse.json(), await unknownResponse.json());
      assert.ok(knownDuration >= 225);
      assert.ok(unknownDuration >= 225);
      assert.ok(Math.abs(knownDuration - unknownDuration) < 150);

      let resetRows = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, user.id));
      assert.equal(resetRows.length, 1);
      tokenIds.push(resetRows[0].id);
      let outboxRows = await db
        .select()
        .from(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.deduplicationKey,
            `password-reset:${resetRows[0].id}`,
          ),
        );
      assert.equal(outboxRows.length, 1);
      assert.equal(outboxRows[0].recipientEmail, user.email);
      assert.equal(outboxRows[0].recipientUserId, user.id);
      assert.equal(outboxRows[0].status, "pending");
      assert.equal(outboxRows[0].providerMessageId, null);
      assert.deepEqual(outboxRows[0].payload, { expiresInMinutes: 30 });
      assert.ok(outboxRows[0].encryptedPayload);
      assert.doesNotMatch(
        JSON.stringify(outboxRows[0].payload),
        /token|resetUrl|reset-password/i,
      );

      const decrypted = await protector.open(
        "password_reset",
        outboxRows[0].encryptedPayload!,
      );
      const resetUrl = new URL(String(decrypted.resetUrl));
      assert.equal(resetUrl.origin, "https://trusted.example.test");
      assert.equal(resetUrl.pathname, "/reset-password");
      assert.equal(resetUrl.searchParams.size, 1);
      const firstToken = resetUrl.searchParams.get("token")!;
      assert.equal(firstToken.length, 43);
      assert.notEqual(resetRows[0].tokenHash, firstToken);
      assert.equal(resetRows[0].tokenHash, hashPasswordResetToken(firstToken));
      assert.doesNotMatch(resetRows[0].tokenHash, new RegExp(firstToken));
      assert.doesNotMatch(outboxRows[0].encryptedPayload!, new RegExp(firstToken));
      assert.equal(
        outboxRows[0].expiresAt?.getTime(),
        resetRows[0].expiresAt.getTime(),
      );

      for (let requestNumber = 0; requestNumber < 3; requestNumber += 1) {
        await request("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email: user.email }),
        });
      }
      resetRows = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, user.id));
      assert.equal(resetRows.length, 3);
      tokenIds.push(...resetRows.slice(1).map(({ id }) => id));
      assert.equal(resetRows.filter(({ revokedAt }) => revokedAt === null).length, 1);

      const activeRow = resetRows.find(({ revokedAt }) => revokedAt === null)!;
      outboxRows = await db
        .select()
        .from(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.deduplicationKey,
            `password-reset:${activeRow.id}`,
          ),
        );
      const activePayload = await protector.open(
        "password_reset",
        outboxRows[0].encryptedPayload!,
      );
      const activeToken = new URL(String(activePayload.resetUrl))
        .searchParams.get("token")!;

      const resetResponse = await request("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token: activeToken,
          newPassword: "NewPassword2!",
        }),
      });
      assert.equal(resetResponse.status, 200);
      const [usedRow] = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.id, activeRow.id));
      assert.ok(usedRow.usedAt);
      const [clearedOutbox] = await db
        .select()
        .from(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.deduplicationKey,
            `password-reset:${activeRow.id}`,
          ),
        );
      assert.equal(clearedOutbox.status, "cancelled");
      assert.equal(clearedOutbox.encryptedPayload, "");

      const replayResponse = await request("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token: activeToken,
          newPassword: "AnotherPassword3!",
        }),
      });
      assert.equal(replayResponse.status, 400);

      const staleSession = await request(
        "/api/auth/me",
        { method: "GET" },
        primaryLogin.cookie,
      );
      const unrelatedSession = await request(
        "/api/auth/me",
        { method: "GET" },
        unrelatedLogin.cookie,
      );
      assert.equal(staleSession.status, 401);
      assert.equal(unrelatedSession.status, 200);
      assert.equal((await login(user.email, "OldPassword1!")).response.status, 401);
      assert.equal((await login(user.email, "NewPassword2!")).response.status, 200);

      const expiredToken = Buffer.alloc(32, 51).toString("base64url");
      const revokedToken = Buffer.alloc(32, 52).toString("base64url");
      const [expiredRow, revokedRow] = await db
        .insert(schema.passwordResetTokens)
        .values([
          {
            userId: user.id,
            tokenHash: hashPasswordResetToken(expiredToken),
            expiresAt: new Date(Date.now() - 1_000),
          },
          {
            userId: user.id,
            tokenHash: hashPasswordResetToken(revokedToken),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date(),
          },
        ])
        .returning();
      tokenIds.push(expiredRow.id, revokedRow.id);
      for (const token of [
        expiredToken,
        revokedToken,
        Buffer.alloc(32, 53).toString("base64url"),
        "malformed",
      ]) {
        const response = await request("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({
            token,
            newPassword: "ValidPassword4!",
          }),
        });
        assert.equal(response.status, 400);
      }

      const concurrent = await service.requestReset(user.email);
      assert.equal(concurrent.issued, true);
      tokenIds.push(concurrent.resetRequestId!);
      const concurrentResults = await Promise.allSettled([
        service.resetPassword(concurrent.token!, "ConcurrentPassword5!"),
        service.resetPassword(concurrent.token!, "ConcurrentPassword5!"),
      ]);
      assert.equal(
        concurrentResults.filter(({ status }) => status === "fulfilled").length,
        1,
      );
      assert.equal(
        concurrentResults.filter(({ status }) => status === "rejected").length,
        1,
      );

      const issuanceResults = await Promise.all([
        service.requestReset(issuanceUser.email),
        service.requestReset(issuanceUser.email),
      ]);
      assert.ok(issuanceResults.every(({ issued }) => issued));
      tokenIds.push(
        ...issuanceResults.map(({ resetRequestId }) => resetRequestId!),
      );
      const issuanceRows = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, issuanceUser.id));
      assert.equal(issuanceRows.length, 2);
      assert.equal(
        issuanceRows.filter(
          ({ usedAt, revokedAt }) => usedAt === null && revokedAt === null,
        ).length,
        1,
      );

      const rollbackToken = Buffer.alloc(32, 61).toString("base64url");
      const failingProtector = {
        seal: async () => {
          throw new Error("simulated encryption failure");
        },
        open: async () => ({}),
      };
      const rollbackService = new PasswordResetService(
        db,
        failingProtector,
        process.env.APP_URL,
        () => rollbackToken,
      );
      await assert.rejects(
        rollbackService.requestReset(unrelatedUser.email),
        /simulated encryption failure/,
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.passwordResetTokens)
            .where(
              eq(
                schema.passwordResetTokens.tokenHash,
                hashPasswordResetToken(rollbackToken),
              ),
            )
        ).length,
        0,
      );

      const collisionToken = Buffer.alloc(32, 62).toString("base64url");
      const [collisionRow] = await db
        .insert(schema.passwordResetTokens)
        .values({
          userId: unrelatedUser.id,
          tokenHash: hashPasswordResetToken(collisionToken),
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      tokenIds.push(collisionRow.id);
      const collisionService = new PasswordResetService(
        db,
        protector,
        process.env.APP_URL,
        () => collisionToken,
      );
      await assert.rejects(collisionService.requestReset(unrelatedUser.email));
      assert.equal(
        (
          await db
            .select()
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `password-reset:${collisionRow.id + 1}`,
              ),
            )
        ).length,
        0,
      );
    } finally {
      await db.delete(schema.passwordResetRateLimits)
        .where(like(schema.passwordResetRateLimits.keyHash, `${marker}:%`));
      if (server) {
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await db
        .delete(schema.emailOutbox)
        .where(like(schema.emailOutbox.recipientEmail, `${marker}-%`));
      if (tokenIds.length > 0) {
        await db
          .delete(schema.passwordResetTokens)
          .where(inArray(schema.passwordResetTokens.id, tokenIds));
      }
      if (userIds.length > 0) {
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
      if (originalKey === undefined) {
        delete process.env.EMAIL_SENSITIVE_PAYLOAD_KEY;
      } else {
        process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = originalKey;
      }
      if (originalAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = originalAppUrl;
      }
    }
  },
);