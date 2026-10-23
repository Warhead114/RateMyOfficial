import assert from "node:assert/strict";
import { assertDevelopmentDatabase } from "./development-database-target";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as schema from "../shared/schema";

const RUN_DATABASE_TESTS = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

test(
  "database-backed authentication, authorization, and review integrity",
  { skip: RUN_DATABASE_TESTS ? false : "Run with npm run test:db" },
  async (t) => {
    const previousEmailUser = process.env.EMAIL_USER;
    process.env.EMAIL_USER = "";

    const [
      { registerRoutes },
      { db, pool },
      { storage },
      { emailOutboxService },
    ] = await Promise.all([
      import("../server/routes"),
      import("../server/db"),
      import("../server/storage"),
      import("../server/email/outbox"),
    ]);

    await assertDevelopmentDatabase(pool);
    await pool.query("SELECT 1");

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    const server = await registerRoutes(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const marker = `dbtest-${process.pid}-${Date.now()}`;
    const password = "DatabaseTestPassword1!";
    const passwordHash = await bcrypt.hash(password, 4);
    const userIds: number[] = [];
    const officialIds: number[] = [];
    const eventIds: number[] = [];
    const teamIds: number[] = [];
    const outboxIds: number[] = [];

    const createUser = async ({
      suffix,
      userType = "Coach",
      role = "user",
      region,
      verified = false,
      school,
    }: {
      suffix: string;
      userType?: "Coach" | "Regional Supervisor";
      role?: string;
      region: string | null;
      verified?: boolean;
      school?: string | null;
    }) => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `${marker}-${suffix}@example.test`,
          password: passwordHash,
          firstName: marker,
          lastName: suffix,
          role,
          userType,
          school: school ?? (userType === "Coach" ? `${marker}-team` : null),
          yearsCoaching: userType === "Coach" ? 1 : null,
          region,
          yearsExperience: userType === "Regional Supervisor" ? 1 : null,
          isVerified: verified,
        })
        .returning();
      userIds.push(user.id);
      return user;
    };

    const createRegistrationOutbox = async (
      user: schema.User,
      status: "pending" | "retry_wait" | "sent" = "pending",
    ) => {
      const now = new Date();
      const [row] = await db
        .insert(schema.emailOutbox)
        .values({
          type: "registration_received",
          recipientUserId: user.id,
          recipientEmail: user.email,
          payload: { firstName: user.firstName },
          deduplicationKey: `registration-received:${user.id}`,
          status,
          scheduledFor: now,
          nextAttemptAt: now,
          attemptCount: status === "pending" ? 0 : 1,
          maxAttempts: 5,
          providerMessageId: status === "sent" ? `test-registration-${user.id}` : null,
          sentAt: status === "sent" ? now : null,
        })
        .returning();
      outboxIds.push(row.id);
      return row;
    };

    const request = async (
      path: string,
      options: RequestInit = {},
      cookie?: string,
    ) => {
      const headers = new Headers(options.headers);
      if (options.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      if (cookie) headers.set("cookie", cookie);
      return fetch(`${baseUrl}${path}`, { ...options, headers });
    };

    const login = async (email: string, loginPassword = password) => {
      const response = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: loginPassword }),
      });
      const setCookie = response.headers.get("set-cookie");
      return {
        response,
        cookie: setCookie?.split(";", 1)[0],
      };
    };

    const registrationForm = (
      email: string,
      photo?: { bytes: Uint8Array; type: string; name: string },
    ) => {
      const form = new FormData();
      form.set("firstName", "Registration");
      form.set("lastName", "Tester");
      form.set("email", email);
      form.set("password", password);
      form.set("confirmPassword", password);
      form.set("userType", "Coach");
      form.set("school", `${marker}-registration-school`);
      form.set("yearsCoaching", "2");
      if (photo) {
        form.set("photo", new Blob([photo.bytes], { type: photo.type }), photo.name);
      }
      return form;
    };

    const createReview = async (
      review: Parameters<typeof storage.createReview>[0],
    ) => {
      const created = await storage.createReview(review);
      const [outboxRow] = await db
        .select({ id: schema.emailOutbox.id })
        .from(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.deduplicationKey,
            `evaluation-submitted:${created.id}`,
          ),
        );
      if (outboxRow) {
        outboxIds.push(outboxRow.id);
      }
      return created;
    };

    try {
      await t.test("only administrators assign explicit regions without approving event emails", async () => {
        const admin = await createUser({ suffix: "region-admin", role: "admin", verified: true });
        const supervisor = await createUser({
          suffix: "region-supervisor", userType: "Regional Supervisor", region: "East", verified: true,
        });
        const [team] = await db.insert(schema.teams).values({
          name: `${marker}-region-team`, region: "East",
        }).returning();
        teamIds.push(team.id);
        const coach = await createUser({
          suffix: "region-coach", school: team.name, region: "East", verified: true,
        });
        await storage.updateUserProfile(coach.id, { region: "East" }, true);
        const identities = () => db.select().from(schema.coachNotificationIdentities)
          .where(eq(schema.coachNotificationIdentities.userId, coach.id));
        assert.equal((await identities()).length, 1);
        const adminLogin = await login(admin.email);
        const supervisorLogin = await login(supervisor.email);
        const coachLogin = await login(coach.email);
        for (const cookie of [supervisorLogin.cookie, coachLogin.cookie]) {
          for (const url of [`/api/admin/coaches/${coach.id}/region`, `/api/admin/teams/${team.id}/region`]) {
            assert.equal((await request(url, {
              method: "PATCH", body: JSON.stringify({ region: "West" }),
            }, cookie)).status, 403);
          }
        }
        assert.equal((await storage.getUserById(coach.id))?.region, "East");
        assert.equal((await storage.getTeamById(team.id))?.region, "East");
        const assigned = await request(`/api/admin/coaches/${coach.id}/region`, {
          method: "PATCH", body: JSON.stringify({ region: " West " }),
        }, adminLogin.cookie);
        assert.equal(assigned.status, 200);
        assert.equal((await storage.getUserById(coach.id))?.region, "West");
        assert.equal((await storage.getUserById(coach.id))?.isVerified, true);
        assert.equal((await identities()).length, 0, "Region assignment must pause, not approve, event mail");
        const teamAssigned = await request(`/api/admin/teams/${team.id}/region`, {
          method: "PATCH", body: JSON.stringify({ region: "West" }),
        }, adminLogin.cookie);
        assert.equal(teamAssigned.status, 200);
        assert.equal((await storage.getTeamById(team.id))?.region, "West");
        assert.equal((await storage.getTeamById(team.id))?.name, team.name);
        assert.equal((await identities()).length, 0);
        assert.equal((await db.select().from(schema.emailOutbox)
          .where(eq(schema.emailOutbox.recipientUserId, coach.id))).length, 0);
      });

      await t.test("legacy token verification endpoint is unavailable", async () => {
        const response = await request("/api/auth/verify?token=legacy-token");
        assert.equal(response.status, 404);
      });

      await t.test(
        "registration creates one pending confirmation atomically for the normalized recipient",
        async () => {
          const email = `${marker}-registration@EXAMPLE.TEST`;
          const normalizedEmail = email.toLowerCase();
          const response = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            body: registrationForm(email),
          });
          assert.equal(response.status, 201);

          const registeredUser = await storage.getUserByEmail(normalizedEmail);
          assert.ok(registeredUser);
          userIds.push(registeredUser.id);

          const rows = await db
            .select()
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `registration-received:${registeredUser.id}`,
              ),
            );
          assert.equal(rows.length, 1);
          const [row] = rows;
          outboxIds.push(row.id);
          assert.equal(row.type, "registration_received");
          assert.equal(row.status, "pending");
          assert.equal(row.recipientUserId, registeredUser.id);
          assert.equal(row.recipientEmail, normalizedEmail);
          assert.deepEqual(row.payload, { firstName: "Registration" });
          assert.equal(row.attemptCount, 0);
          assert.equal(row.providerMessageId, null);

          const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            body: registrationForm(email),
          });
          assert.equal(duplicate.status, 400);
          const duplicateRows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `registration-received:${registeredUser.id}`,
              ),
            );
          assert.equal(duplicateRows.length, 1);

          await assert.rejects(
            storage.createUserWithRegistrationEmail({
              email: normalizedEmail,
              password,
              confirmPassword: password,
              firstName: "Duplicate",
              lastName: "Registration",
              userType: "Coach",
              school: `${marker}-registration-school`,
            }),
          );
          const usersWithEmail = await db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.email, normalizedEmail));
          assert.equal(usersWithEmail.length, 1);
        },
      );

      await t.test(
        "invalid optional registration photo leaves no account or outbox message",
        async () => {
          const email = `${marker}-invalid-photo@example.test`;
          const response = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            body: registrationForm(email, {
              bytes: new Uint8Array([0, 1, 2, 3, 4]),
              type: "image/png",
              name: "invalid.png",
            }),
          });
          assert.equal(response.status, 400);
          assert.equal(await storage.getUserByEmail(email), undefined);
          const rows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.recipientEmail, email));
          assert.equal(rows.length, 0);
        },
      );

      await t.test(
        "a valid registration photo is removed when account persistence fails",
        async () => {
          const email = `${marker}-photo-persistence-failure@example.test`;
          const uploadsDirectory = path.join(process.cwd(), "uploads");
          const before = new Set(
            await fs.readdir(uploadsDirectory).catch(() => [] as string[]),
          );
          const png = await sharp({
            create: {
              width: 1,
              height: 1,
              channels: 3,
              background: "red",
            },
          }).png().toBuffer();
          const originalCreate = storage.createUserWithRegistrationEmail;
          storage.createUserWithRegistrationEmail = async () => {
            throw new Error("Simulated persistence failure");
          };

          try {
            const response = await fetch(`${baseUrl}/api/auth/register`, {
              method: "POST",
              body: registrationForm(email, {
                bytes: png,
                type: "image/png",
                name: "valid.png",
              }),
            });
            assert.equal(response.status, 500);
          } finally {
            storage.createUserWithRegistrationEmail = originalCreate;
          }

          assert.equal(await storage.getUserByEmail(email), undefined);
          const rows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.recipientEmail, email));
          assert.equal(rows.length, 0);
          const after = new Set(
            await fs.readdir(uploadsDirectory).catch(() => [] as string[]),
          );
          assert.deepEqual(after, before);
        },
      );

      const supervisor = await createUser({
        suffix: "supervisor",
        userType: "Regional Supervisor",
        region: "East",
        verified: true,
      });
      const coach = await createUser({
        suffix: "coach",
        region: "East",
        verified: true,
      });
      const inRegionCoach = await createUser({
        suffix: "in-region",
        region: " east ",
      });
      const outOfRegionCoach = await createUser({
        suffix: "out-of-region",
        region: "West",
      });
      const pendingSupervisor = await createUser({
        suffix: "pending-supervisor",
        userType: "Regional Supervisor",
        region: "East",
      });

      await t.test("valid and invalid login use database credentials", async () => {
        const invalid = await login(supervisor.email, "wrong-password");
        assert.equal(invalid.response.status, 401);

        const valid = await login(supervisor.email);
        assert.equal(valid.response.status, 200);
        assert.ok(valid.cookie, "successful login must establish a session");
        assert.equal((await valid.response.json()).id, supervisor.id);
      });

      await t.test(
        "protected supervisor endpoints reject unauthenticated and Coach callers",
        async () => {
          const unauthenticated = await request("/api/users/pending");
          assert.equal(unauthenticated.status, 403);

          const coachLogin = await login(coach.email);
          assert.equal(coachLogin.response.status, 200);
          assert.ok(coachLogin.cookie);
          const coachAttempt = await request(
            "/api/users/pending",
            {},
            coachLogin.cookie,
          );
          assert.equal(coachAttempt.status, 403);
        },
      );

      await t.test(
        "a supervisor can approve only a coach in the same normalized region",
        async () => {
          const supervisorLogin = await login(supervisor.email);
          assert.ok(supervisorLogin.cookie);

          const invalidDecisionTarget = await createUser({
            suffix: "invalid-verification-decision",
            region: "East",
          });
          const invalidBodies = [
            {},
            { approved: null },
            { approved: "false" },
            { approved: "true" },
            { approved: 0 },
            { approved: 1 },
            { approved: [] },
            { approved: {} },
            { approved: false, unexpected: true },
          ];
          for (const body of invalidBodies) {
            const invalidDecision = await request(
              `/api/users/${invalidDecisionTarget.id}/verify`,
              {
                method: "POST",
                body: JSON.stringify(body),
              },
              supervisorLogin.cookie,
            );
            assert.equal(invalidDecision.status, 400);
            assert.equal(
              (await storage.getUserById(invalidDecisionTarget.id))?.isVerified,
              false,
            );
          }
          const invalidDecisionRows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.recipientUserId, invalidDecisionTarget.id));
          assert.equal(invalidDecisionRows.length, 0);

          const inRegionApproval = await request(
            `/api/users/${inRegionCoach.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: true }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(inRegionApproval.status, 200);
          assert.equal(
            (await storage.getUserById(inRegionCoach.id))?.isVerified,
            true,
          );
          const approvedRows = await db
            .select()
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-approved:${inRegionCoach.id}`,
              ),
            );
          assert.equal(approvedRows.length, 1);
          outboxIds.push(approvedRows[0].id);
          assert.equal(approvedRows[0].type, "account_approved");
          assert.equal(approvedRows[0].status, "pending");
          assert.equal(approvedRows[0].recipientEmail, inRegionCoach.email);
          assert.equal(approvedRows[0].recipientUserId, inRegionCoach.id);
          assert.deepEqual(approvedRows[0].payload, {
            firstName: inRegionCoach.firstName,
          });
          assert.equal(approvedRows[0].providerMessageId, null);

          const repeatedApproval = await request(
            `/api/users/${inRegionCoach.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: true }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(repeatedApproval.status, 200);
          const repeatedApprovalRows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-approved:${inRegionCoach.id}`,
              ),
            );
          assert.equal(repeatedApprovalRows.length, 1);

          const conflictingRejection = await request(
            `/api/users/${inRegionCoach.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: false }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(conflictingRejection.status, 409);
          assert.equal(
            (await storage.getUserById(inRegionCoach.id))?.isVerified,
            true,
          );
          const contradictoryRows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-rejected:${inRegionCoach.id}`,
              ),
            );
          assert.equal(contradictoryRows.length, 0);

          const outOfRegionApproval = await request(
            `/api/users/${outOfRegionCoach.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: true }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(outOfRegionApproval.status, 403);
          assert.equal(
            (await storage.getUserById(outOfRegionCoach.id))?.isVerified,
            false,
          );

          const rejectionTarget = await createUser({
            suffix: "rejection-target",
            region: "East",
          });
          const pendingRegistration =
            await createRegistrationOutbox(rejectionTarget);
          const rejection = await request(
            `/api/users/${rejectionTarget.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: false }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(rejection.status, 200);
          assert.equal(await storage.getUserById(rejectionTarget.id), undefined);

          const [cancelledRegistration] = await db
            .select()
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.id, pendingRegistration.id));
          assert.equal(cancelledRegistration.status, "cancelled");
          assert.equal(cancelledRegistration.attemptCount, 0);
          assert.equal(cancelledRegistration.lastErrorCode, "ACCOUNT_REJECTED");
          assert.equal(
            cancelledRegistration.lastError,
            "Registration email cancelled because the account was rejected",
          );
          assert.equal(cancelledRegistration.recipientUserId, null);
          assert.equal(cancelledRegistration.claimedAt, null);
          assert.equal(cancelledRegistration.claimedBy, null);
          assert.equal(cancelledRegistration.claimToken, null);

          const rejectedRows = await db
            .select()
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-rejected:${rejectionTarget.id}`,
              ),
            );
          assert.equal(rejectedRows.length, 1);
          outboxIds.push(rejectedRows[0].id);
          assert.equal(rejectedRows[0].type, "account_rejected");
          assert.equal(rejectedRows[0].status, "pending");
          assert.equal(rejectedRows[0].recipientEmail, rejectionTarget.email);
          assert.equal(rejectedRows[0].recipientUserId, null);
          assert.deepEqual(rejectedRows[0].payload, {
            firstName: rejectionTarget.firstName,
          });
          assert.equal(rejectedRows[0].providerMessageId, null);

          const repeatedRejection = await request(
            `/api/users/${rejectionTarget.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: false }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(repeatedRejection.status, 404);
          const repeatedRejectionRows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-rejected:${rejectionTarget.id}`,
              ),
            );
          assert.equal(repeatedRejectionRows.length, 1);

          const retryWaitTarget = await createUser({
            suffix: "retry-wait-rejection-target",
            region: "East",
          });
          const retryWaitRegistration = await createRegistrationOutbox(
            retryWaitTarget,
            "retry_wait",
          );
          const retryWaitRejection = await request(
            `/api/users/${retryWaitTarget.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: false }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(retryWaitRejection.status, 200);
          assert.equal(await storage.getUserById(retryWaitTarget.id), undefined);
          const [cancelledRetryWaitRegistration] = await db
            .select()
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.id, retryWaitRegistration.id));
          assert.equal(cancelledRetryWaitRegistration.status, "cancelled");
          assert.equal(cancelledRetryWaitRegistration.attemptCount, 1);
          assert.equal(
            cancelledRetryWaitRegistration.lastErrorCode,
            "ACCOUNT_REJECTED",
          );
          const retryWaitRejectedRows = await db
            .select()
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-rejected:${retryWaitTarget.id}`,
              ),
            );
          assert.equal(retryWaitRejectedRows.length, 1);
          outboxIds.push(retryWaitRejectedRows[0].id);

          const sentRegistrationTarget = await createUser({
            suffix: "sent-registration-rejection-target",
            region: "East",
          });
          const sentRegistration = await createRegistrationOutbox(
            sentRegistrationTarget,
            "sent",
          );
          const sentRegistrationRejection = await request(
            `/api/users/${sentRegistrationTarget.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: false }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(sentRegistrationRejection.status, 200);
          assert.equal(
            await storage.getUserById(sentRegistrationTarget.id),
            undefined,
          );
          const [preservedSentRegistration] = await db
            .select()
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.id, sentRegistration.id));
          assert.equal(preservedSentRegistration.status, "sent");
          assert.equal(preservedSentRegistration.attemptCount, 1);
          assert.equal(preservedSentRegistration.maxAttempts, 5);
          assert.equal(
            preservedSentRegistration.providerMessageId,
            sentRegistration.providerMessageId,
          );
          assert.equal(
            preservedSentRegistration.sentAt?.getTime(),
            sentRegistration.sentAt?.getTime(),
          );
          assert.equal(preservedSentRegistration.lastErrorCode, null);
          assert.equal(preservedSentRegistration.recipientUserId, null);
          const sentRegistrationRejectedRows = await db
            .select()
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-rejected:${sentRegistrationTarget.id}`,
              ),
            );
          assert.equal(sentRegistrationRejectedRows.length, 1);
          outboxIds.push(sentRegistrationRejectedRows[0].id);

          const processingRegistrationTarget = await createUser({
            suffix: "processing-registration-rejection-target",
            region: "East",
          });
          const processingRegistration = await createRegistrationOutbox(
            processingRegistrationTarget,
          );
          const claimedRegistration = await emailOutboxService.claimExactMessage({
            id: processingRegistration.id,
            workerId: `${marker}-registration-worker`,
            expectedType: "registration_received",
            expectedRecipientEmail: processingRegistrationTarget.email,
            expectedDeduplicationKey:
              `registration-received:${processingRegistrationTarget.id}`,
            now: new Date(),
          });
          assert.equal(claimedRegistration?.status, "processing");
          const processingRegistrationRejection = await request(
            `/api/users/${processingRegistrationTarget.id}/verify`,
            {
              method: "POST",
              body: JSON.stringify({ approved: false }),
            },
            supervisorLogin.cookie,
          );
          assert.equal(processingRegistrationRejection.status, 409);
          assert.equal(
            (await storage.getUserById(processingRegistrationTarget.id))
              ?.isVerified,
            false,
          );
          const [preservedProcessingRegistration] = await db
            .select()
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.id, processingRegistration.id));
          assert.equal(preservedProcessingRegistration.status, "processing");
          assert.equal(
            preservedProcessingRegistration.claimToken,
            claimedRegistration?.claimToken,
          );
          const processingRejectedRows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-rejected:${processingRegistrationTarget.id}`,
              ),
            );
          assert.equal(processingRejectedRows.length, 0);

          const rollbackTarget = await createUser({
            suffix: "rejection-rollback-target",
            region: "East",
          });
          const rollbackRegistration =
            await createRegistrationOutbox(rollbackTarget);
          const [rollbackOfficial] = await db
            .insert(schema.officials)
            .values({
              firstName: marker,
              lastName: "rollback-official",
              age: 30,
              location: "East",
              association: "East",
              yearsExperience: 5,
              averageRating: 4,
              totalReviews: 1,
            })
            .returning();
          officialIds.push(rollbackOfficial.id);
          const [rollbackEvent] = await db
            .insert(schema.events)
            .values({
              name: `${marker}-rollback-event`,
              date: new Date(),
              venue: "Test venue",
              eventType: "Test",
              region: "East",
            })
            .returning();
          eventIds.push(rollbackEvent.id);
          const [rollbackReview] = await db
            .insert(schema.reviews)
            .values({
              officialId: rollbackOfficial.id,
              userId: rollbackTarget.id,
              eventId: rollbackEvent.id,
              mechanics: 4,
              professionalism: 4,
              positioning: 4,
              stalling: 4,
              consistency: 4,
              appearance: 4,
              comment: "Rollback test",
              isPending: false,
            })
            .returning();
          const storageInternals = storage as unknown as {
            createRatingsService: (...args: unknown[]) => unknown;
          };
          const originalCreateRatingsService =
            storageInternals.createRatingsService;
          storageInternals.createRatingsService = () => {
            throw new Error("Forced rejection transaction failure");
          };
          try {
            const rollbackRejection = await request(
              `/api/users/${rollbackTarget.id}/verify`,
              {
                method: "POST",
                body: JSON.stringify({ approved: false }),
              },
              supervisorLogin.cookie,
            );
            assert.equal(rollbackRejection.status, 500);
          } finally {
            storageInternals.createRatingsService =
              originalCreateRatingsService;
          }
          assert.equal(
            (await storage.getUserById(rollbackTarget.id))?.isVerified,
            false,
          );
          const [preservedRollbackRegistration] = await db
            .select()
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.id, rollbackRegistration.id));
          assert.equal(preservedRollbackRegistration.status, "pending");
          assert.equal(preservedRollbackRegistration.lastErrorCode, null);
          const preservedRollbackReview = await db
            .select({ id: schema.reviews.id })
            .from(schema.reviews)
            .where(eq(schema.reviews.id, rollbackReview.id));
          assert.equal(preservedRollbackReview.length, 1);
          const preservedRollbackOfficial = await storage.getOfficialById(
            rollbackOfficial.id,
          );
          assert.equal(preservedRollbackOfficial?.averageRating, 4);
          assert.equal(preservedRollbackOfficial?.totalReviews, 1);
          const rollbackRejectedRows = await db
            .select({ id: schema.emailOutbox.id })
            .from(schema.emailOutbox)
            .where(
              eq(
                schema.emailOutbox.deduplicationKey,
                `account-rejected:${rollbackTarget.id}`,
              ),
            );
          assert.equal(rollbackRejectedRows.length, 0);

          const concurrentTarget = await createUser({
            suffix: "concurrent-verification-target",
            region: "East",
          });
          const [approvalDecision, rejectionDecision] = await Promise.all([
            request(
              `/api/users/${concurrentTarget.id}/verify`,
              {
                method: "POST",
                body: JSON.stringify({ approved: true }),
              },
              supervisorLogin.cookie,
            ),
            request(
              `/api/users/${concurrentTarget.id}/verify`,
              {
                method: "POST",
                body: JSON.stringify({ approved: false }),
              },
              supervisorLogin.cookie,
            ),
          ]);
          assert.equal(
            [approvalDecision.status, rejectionDecision.status].filter(
              (status) => status === 200,
            ).length,
            1,
          );

          const decisionRows = await db
            .select()
            .from(schema.emailOutbox)
            .where(eq(schema.emailOutbox.recipientEmail, concurrentTarget.email));
          assert.equal(decisionRows.length, 1);
          outboxIds.push(decisionRows[0].id);
          assert.ok(
            decisionRows[0].type === "account_approved" ||
            decisionRows[0].type === "account_rejected",
          );
          const concurrentUser = await storage.getUserById(concurrentTarget.id);
          if (decisionRows[0].type === "account_approved") {
            assert.equal(concurrentUser?.isVerified, true);
            assert.equal(rejectionDecision.status, 409);
          } else {
            assert.equal(concurrentUser, undefined);
            assert.equal(approvalDecision.status, 404);
          }
        },
      );

      await t.test(
        "pending supervisors cannot self-approve or manage teams/events while approved supervisors can",
        async () => {
          const pendingLogin = await login(pendingSupervisor.email);
          assert.ok(pendingLogin.cookie);
          const selfApproval = await request(
            `/api/users/${pendingSupervisor.id}/verify`,
            { method: "POST", body: JSON.stringify({ approved: true }) },
            pendingLogin.cookie,
          );
          assert.equal(selfApproval.status, 403);
          assert.equal((await storage.getUserById(pendingSupervisor.id))?.isVerified, false);

          const pendingTeam = await request(
            "/api/teams",
            { method: "POST", body: JSON.stringify({ name: `${marker}-pending-team`, region: "East" }) },
            pendingLogin.cookie,
          );
          assert.equal(pendingTeam.status, 403);
          const pendingEvent = await request(
            "/api/events",
            { method: "POST", body: JSON.stringify({ name: "denied", date: "2020-01-01", venue: "Gym", eventType: "Tournament", officials: [] }) },
            pendingLogin.cookie,
          );
          assert.equal(pendingEvent.status, 403);

          const approvedLogin = await login(supervisor.email);
          assert.ok(approvedLogin.cookie);
          const approvedTeam = await request(
            "/api/teams",
            { method: "POST", body: JSON.stringify({ name: `${marker}-approved-team`, region: "West" }) },
            approvedLogin.cookie,
          );
          assert.equal(approvedTeam.status, 201);
          const team = await approvedTeam.json();
          teamIds.push(team.id);
          assert.equal(team.region, "east");

          const [official] = await db.insert(schema.officials).values({
            firstName: marker, lastName: "authorized-event-official", age: 30,
            location: "East", association: "East", yearsExperience: 3,
          }).returning();
          officialIds.push(official.id);
          const approvedEvent = await request(
            "/api/events",
            {
              method: "POST",
              body: JSON.stringify({
                name: `${marker}-authorized-event`, date: "2020-01-01", venue: "Gym",
                eventType: "Tournament", region: "West",
                officials: [{ officialId: official.id }], teams: [team.id],
              }),
            },
            approvedLogin.cookie,
          );
          assert.equal(approvedEvent.status, 201);
          eventIds.push((await approvedEvent.json()).id);
        },
      );

      await t.test(
        "review invariants and rating changes are persisted atomically",
        async () => {
          const pendingReviewer = await createUser({
            suffix: "pending-reviewer",
            region: "East",
          });
          const secondReviewer = await createUser({
            suffix: "second-reviewer",
            region: "East",
            verified: true,
          });

          const [official] = await db
            .insert(schema.officials)
            .values({
              firstName: marker,
              lastName: "official",
              age: 35,
              location: "East",
              association: "East",
              yearsExperience: 10,
            })
            .returning();
          officialIds.push(official.id);

          const [team] = await db
            .insert(schema.teams)
            .values({ name: `${marker}-team`, region: "East" })
            .returning();
          teamIds.push(team.id);

          const pastEvent = await storage.createEvent({
            name: `${marker}-past`,
            date: new Date(Date.now() - 86_400_000),
            venue: "Integration Gym",
            eventType: "Tournament",
            region: "East",
            officials: [{ officialId: official.id, role: "Official" }],
            teams: [team.id],
          });
          eventIds.push(pastEvent.id);
          assert.deepEqual(
            (await storage.getEventOfficials(pastEvent.id)).map(({ id }) => id),
            [official.id],
          );
          assert.deepEqual(
            (await storage.getEventTeams(pastEvent.id)).map(({ id }) => id),
            [team.id],
          );

          const unassignedEvent = await storage.createEvent({
            name: `${marker}-unassigned`,
            date: new Date(Date.now() - 86_400_000),
            venue: "Integration Gym",
            eventType: "Tournament",
            region: "East",
            officials: [],
            teams: [],
          });
          eventIds.push(unassignedEvent.id);

          const futureEvent = await storage.createEvent({
            name: `${marker}-future`,
            date: new Date(Date.now() + 86_400_000),
            venue: "Integration Gym",
            eventType: "Tournament",
            region: "East",
            officials: [{ officialId: official.id, role: "Official" }],
            teams: [],
          });
          eventIds.push(futureEvent.id);

          const fiveStarReview = {
            officialId: official.id,
            eventId: pastEvent.id,
            mechanics: 5,
            professionalism: 5,
            positioning: 5,
            stalling: 5,
            consistency: 5,
            appearance: 5,
            comment: "Database integration review",
          };

          const pendingReview = await createReview({
            ...fiveStarReview,
            userId: pendingReviewer.id,
          });
          assert.equal(pendingReview.isPending, true);
          assert.deepEqual(
            await storage.getOfficialRatingBreakdown(official.id),
            {
              mechanics: 0,
              professionalism: 0,
              positioning: 0,
              stalling: 0,
              consistency: 0,
              appearance: 0,
              overall: 0,
              approvedReviewCount: 0,
            },
          );

          // Only administrative approval activates a pending review and
          // recalculates its official's denormalized rating.
          assert.equal(
            (await storage.getUserById(pendingReviewer.id))?.isVerified,
            false,
          );
          await storage.approveUser(pendingReviewer.id);
          assert.equal(
            (await storage.getReviewById(pendingReview.id))?.isPending,
            false,
          );
          let persistedOfficial = await storage.getOfficialById(official.id);
          assert.equal(persistedOfficial?.averageRating, 5);
          assert.equal(persistedOfficial?.totalReviews, 1);

          await assert.rejects(
            db.insert(schema.reviews).values({
              ...fiveStarReview,
              userId: pendingReviewer.id,
              comment: "Duplicate tuple",
              isPending: false,
            }),
            (error: unknown) =>
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "23505",
          );

          await assert.rejects(
            createReview({
              ...fiveStarReview,
              userId: secondReviewer.id,
              eventId: unassignedEvent.id,
            }),
            /not assigned/,
          );
          await assert.rejects(
            createReview({
              ...fiveStarReview,
              userId: secondReviewer.id,
              eventId: futureEvent.id,
            }),
            /Future events/,
          );

          const oneStarReview = await createReview({
            ...fiveStarReview,
            userId: secondReviewer.id,
            mechanics: 1,
            professionalism: 1,
            positioning: 1,
            stalling: 1,
            consistency: 1,
            appearance: 1,
          });
          persistedOfficial = await storage.getOfficialById(official.id);
          assert.equal(persistedOfficial?.averageRating, 3);
          assert.equal(persistedOfficial?.totalReviews, 2);

          await storage.deleteReview(pendingReview.id);
          persistedOfficial = await storage.getOfficialById(official.id);
          assert.equal(persistedOfficial?.averageRating, 1);
          assert.equal(persistedOfficial?.totalReviews, 1);
          assert.ok(await storage.getReviewById(oneStarReview.id));
        },
      );

      await t.test(
        "cascade deletions recalculate only affected surviving officials",
        async () => {
          const approvedReviewer = await createUser({
            suffix: "event-delete-approved",
            region: "East",
            verified: true,
          });
          const secondApprovedReviewer = await createUser({
            suffix: "event-delete-second-approved",
            region: "East",
            verified: true,
          });
          const pendingReviewer = await createUser({
            suffix: "event-delete-pending",
            region: "East",
          });
          const deletableReviewer = await createUser({
            suffix: "user-delete-approved",
            region: "East",
            verified: true,
          });

          const createOfficial = async (suffix: string) => {
            const [official] = await db
              .insert(schema.officials)
              .values({
                firstName: marker,
                lastName: suffix,
                age: 35,
                location: "East",
                association: "East",
                yearsExperience: 10,
              })
              .returning();
            officialIds.push(official.id);
            return official;
          };
          const onlyReviewOfficial = await createOfficial("only-review");
          const partialReviewOfficial = await createOfficial("partial-review");
          const multipleReviewOfficial = await createOfficial("multiple-review");
          const unrelatedOfficial = await createOfficial("unrelated");
          const userDeleteOfficial = await createOfficial("user-delete");

          const deletedEvent = await storage.createEvent({
            name: `${marker}-deleted-event`,
            date: new Date(Date.now() - 86_400_000),
            venue: "Integration Gym",
            eventType: "Tournament",
            region: "East",
            officials: [
              { officialId: onlyReviewOfficial.id, role: "Official" },
              { officialId: partialReviewOfficial.id, role: "Official" },
              { officialId: multipleReviewOfficial.id, role: "Official" },
            ],
            teams: [],
          });
          eventIds.push(deletedEvent.id);

          const retainedEvent = await storage.createEvent({
            name: `${marker}-retained-event`,
            date: new Date(Date.now() - 86_400_000),
            venue: "Integration Gym",
            eventType: "Tournament",
            region: "East",
            officials: [
              { officialId: partialReviewOfficial.id, role: "Official" },
              { officialId: multipleReviewOfficial.id, role: "Official" },
              { officialId: unrelatedOfficial.id, role: "Official" },
            ],
            teams: [],
          });
          eventIds.push(retainedEvent.id);

          const userDeleteEvent = await storage.createEvent({
            name: `${marker}-user-delete-event`,
            date: new Date(Date.now() - 86_400_000),
            venue: "Integration Gym",
            eventType: "Tournament",
            region: "East",
            officials: [
              { officialId: userDeleteOfficial.id, role: "Official" },
            ],
            teams: [],
          });
          eventIds.push(userDeleteEvent.id);

          const ratingReview = (
            officialId: number,
            eventId: number,
            userId: number,
            value: number,
          ) => ({
            officialId,
            eventId,
            userId,
            mechanics: value,
            professionalism: value,
            positioning: value,
            stalling: value,
            consistency: value,
            appearance: value,
            comment: `${marker}-${value}`,
          });

          await createReview(
            ratingReview(
              onlyReviewOfficial.id,
              deletedEvent.id,
              approvedReviewer.id,
              5,
            ),
          );
          await createReview(
            ratingReview(
              partialReviewOfficial.id,
              deletedEvent.id,
              approvedReviewer.id,
              5,
            ),
          );
          await createReview(
            ratingReview(
              partialReviewOfficial.id,
              retainedEvent.id,
              approvedReviewer.id,
              1,
            ),
          );
          await createReview(
            ratingReview(
              multipleReviewOfficial.id,
              deletedEvent.id,
              approvedReviewer.id,
              4,
            ),
          );
          await createReview(
            ratingReview(
              multipleReviewOfficial.id,
              deletedEvent.id,
              pendingReviewer.id,
              1,
            ),
          );
          const retainedPendingReview = await createReview(
            ratingReview(
              multipleReviewOfficial.id,
              retainedEvent.id,
              pendingReviewer.id,
              2,
            ),
          );
          await createReview(
            ratingReview(
              unrelatedOfficial.id,
              retainedEvent.id,
              approvedReviewer.id,
              3,
            ),
          );
          await createReview(
            ratingReview(
              userDeleteOfficial.id,
              userDeleteEvent.id,
              deletableReviewer.id,
              5,
            ),
          );
          await createReview(
            ratingReview(
              userDeleteOfficial.id,
              userDeleteEvent.id,
              secondApprovedReviewer.id,
              1,
            ),
          );

          await db
            .update(schema.officials)
            .set({ averageRating: 4.7, totalReviews: 9 })
            .where(eq(schema.officials.id, unrelatedOfficial.id));

          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(multipleReviewOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(multipleReviewOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 4, totalReviews: 1 },
          );
          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(userDeleteOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(userDeleteOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 3, totalReviews: 2 },
          );
          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(unrelatedOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(unrelatedOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 4.7, totalReviews: 9 },
          );

          await storage.deleteEvent(deletedEvent.id);

          assert.equal(await storage.getEventById(deletedEvent.id), undefined);
          assert.ok(await storage.getReviewById(retainedPendingReview.id));
          assert.deepEqual(
            await storage.getReviewsForOfficial(onlyReviewOfficial.id, true),
            [],
          );
          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(onlyReviewOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(onlyReviewOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 0, totalReviews: 0 },
          );
          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(partialReviewOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(partialReviewOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 1, totalReviews: 1 },
          );
          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(multipleReviewOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(multipleReviewOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 0, totalReviews: 0 },
          );
          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(unrelatedOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(unrelatedOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 4.7, totalReviews: 9 },
          );

          await storage.deleteUser(deletableReviewer.id);
          assert.deepEqual(
            {
              averageRating: (
                await storage.getOfficialById(userDeleteOfficial.id)
              )?.averageRating,
              totalReviews: (
                await storage.getOfficialById(userDeleteOfficial.id)
              )?.totalReviews,
            },
            { averageRating: 1, totalReviews: 1 },
          );
        },
      );
    } finally {
      await pool.query(
        "DELETE FROM email_outbox WHERE type = 'evaluation_submitted' AND payload->>'audience' = 'reviewer' AND payload->>'coachName' LIKE $1",
        [`${marker} %`]);
      if (userIds.length > 0) {
        const fixtureReviews = await db.select({ id: schema.reviews.id })
          .from(schema.reviews).where(inArray(schema.reviews.userId, userIds));
        for (const review of fixtureReviews) {
          await pool.query("DELETE FROM email_outbox WHERE deduplication_key LIKE $1",
            [`evaluation-reviewer:${review.id}:%`]);
        }
        await pool.query(
          "DELETE FROM email_outbox WHERE recipient_user_id = ANY($1::int[]) AND type IN ('event_created','event_reminder')",
          [userIds]);
      }
      if (outboxIds.length > 0) {
        await db
          .delete(schema.emailOutbox)
          .where(inArray(schema.emailOutbox.id, outboxIds));
      }
      if (userIds.length > 0) {
        await db
          .delete(schema.reviews)
          .where(inArray(schema.reviews.userId, userIds));
      }
      if (eventIds.length > 0) {
        await db
          .delete(schema.eventOfficials)
          .where(inArray(schema.eventOfficials.eventId, eventIds));
        await db
          .delete(schema.eventTeams)
          .where(inArray(schema.eventTeams.eventId, eventIds));
        await db.delete(schema.events).where(inArray(schema.events.id, eventIds));
      }
      if (officialIds.length > 0) {
        await db
          .delete(schema.officials)
          .where(inArray(schema.officials.id, officialIds));
      }
      if (teamIds.length > 0) {
        await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
      }
      if (userIds.length > 0) {
        await db
          .delete(schema.userSettings)
          .where(inArray(schema.userSettings.userId, userIds));
        await db
          .delete(schema.notifications)
          .where(inArray(schema.notifications.userId, userIds));
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
      if (previousEmailUser === undefined) {
        delete process.env.EMAIL_USER;
      } else {
        process.env.EMAIL_USER = previousEmailUser;
      }
    }
  },
);
