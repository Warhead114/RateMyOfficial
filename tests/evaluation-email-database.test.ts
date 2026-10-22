import assert from "node:assert/strict";
import { assertDevelopmentDatabase } from "./development-database-target";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../shared/schema";
import { db, pool } from "../server/db";
import { emailOutboxService } from "../server/email/outbox";
import { storage } from "../server/storage";

const RUN_DATABASE_TESTS = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

test(
  "database-backed evaluation confirmation integration",
  { skip: RUN_DATABASE_TESTS ? false : "Run with npm run test:db" },
  async () => {
    await assertDevelopmentDatabase(pool);
    await pool.query("SELECT 1");
    const marker = `evaluation-email-${process.pid}-${Date.now()}`;
    const passwordHash = await bcrypt.hash("EvaluationTestPassword1!", 4);
    const userIds: number[] = [];
    const officialIds: number[] = [];
    const eventIds: number[] = [];
    const outboxIds: number[] = [];

    const createUser = async (
      suffix: string,
      isVerified: boolean,
    ) => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `${marker}-${suffix}@example.test`,
          password: passwordHash,
          firstName: marker,
          lastName: suffix,
          role: "user",
          userType: "Coach",
          school: `${marker}-school`,
          yearsCoaching: 2,
          region: "East",
          isVerified,
        })
        .returning();
      userIds.push(user.id);
      return user;
    };

    try {
      const approvedUser = await createUser("approved", true);
      const pendingUser = await createUser("pending", false);
      const rollbackUser = await createUser("rollback", true);

      const [official] = await db
        .insert(schema.officials)
        .values({
          firstName: "Jordan",
          lastName: "Lee",
          age: 35,
          location: "East",
          association: "East",
          yearsExperience: 10,
        })
        .returning();
      officialIds.push(official.id);

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `${marker}-event`,
          date: new Date(Date.now() - 86_400_000),
          venue: "Evaluation Test Gym",
          eventType: "Tournament",
          region: "East",
        })
        .returning();
      eventIds.push(event.id);

      await db.insert(schema.eventOfficials).values({
        eventId: event.id,
        officialId: official.id,
        role: "Official",
      });

      const reviewInput = {
        officialId: official.id,
        eventId: event.id,
        mechanics: 5,
        professionalism: 5,
        positioning: 5,
        stalling: 5,
        consistency: 5,
        appearance: 5,
        comment: "This must not appear in the confirmation.",
        videoUrl: "/uploads/private-video.mp4",
      };

      const approvedReview = await storage.createReview({
        ...reviewInput,
        userId: approvedUser.id,
      });
      assert.equal(approvedReview.isPending, false);
      const approvedOfficial = await storage.getOfficialById(official.id);
      assert.equal(approvedOfficial?.averageRating, 5);
      assert.equal(approvedOfficial?.totalReviews, 1);

      const approvedOutbox = await db
        .select()
        .from(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.deduplicationKey,
            `evaluation-submitted:${approvedReview.id}`,
          ),
        );
      assert.equal(approvedOutbox.length, 1);
      outboxIds.push(approvedOutbox[0].id);
      assert.equal(approvedOutbox[0].type, "evaluation_submitted");
      assert.equal(approvedOutbox[0].status, "pending");
      assert.equal(approvedOutbox[0].recipientUserId, approvedUser.id);
      assert.equal(approvedOutbox[0].recipientEmail, approvedUser.email);
      assert.deepEqual(approvedOutbox[0].payload, {
        firstName: approvedUser.firstName,
        eventName: event.name,
        officialName: "Jordan Lee",
        isPending: false,
      });
      assert.equal(approvedOutbox[0].providerMessageId, null);

      await assert.rejects(
        storage.createReview({
          ...reviewInput,
          userId: approvedUser.id,
          comment: "Duplicate review",
        }),
        /already reviewed/,
      );
      const duplicateRows = await db
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(eq(schema.reviews.userId, approvedUser.id));
      assert.equal(duplicateRows.length, 1);
      const duplicateOutbox = await db
        .select({ id: schema.emailOutbox.id })
        .from(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.deduplicationKey,
            `evaluation-submitted:${approvedReview.id}`,
          ),
        );
      assert.equal(duplicateOutbox.length, 1);

      const pendingReview = await storage.createReview({
        ...reviewInput,
        userId: pendingUser.id,
      });
      assert.equal(pendingReview.isPending, true);
      const pendingOfficial = await storage.getOfficialById(official.id);
      assert.equal(pendingOfficial?.averageRating, 5);
      assert.equal(pendingOfficial?.totalReviews, 1);

      const pendingOutbox = await db
        .select()
        .from(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.deduplicationKey,
            `evaluation-submitted:${pendingReview.id}`,
          ),
        );
      assert.equal(pendingOutbox.length, 1);
      outboxIds.push(pendingOutbox[0].id);
      assert.equal(pendingOutbox[0].status, "pending");
      assert.equal(pendingOutbox[0].recipientUserId, pendingUser.id);
      assert.equal(pendingOutbox[0].recipientEmail, pendingUser.email);
      assert.deepEqual(pendingOutbox[0].payload, {
        firstName: pendingUser.firstName,
        eventName: event.name,
        officialName: "Jordan Lee",
        isPending: true,
      });
      assert.equal(pendingOutbox[0].providerMessageId, null);

      const baselineRating = await storage.getOfficialById(official.id);
      const originalWithExecutor = emailOutboxService.withExecutor;
      (emailOutboxService as unknown as {
        withExecutor: typeof emailOutboxService.withExecutor;
      }).withExecutor = () => {
        throw new Error("Simulated outbox failure");
      };
      try {
        await assert.rejects(
          storage.createReview({
            ...reviewInput,
            userId: rollbackUser.id,
            mechanics: 1,
            professionalism: 1,
            positioning: 1,
            stalling: 1,
            consistency: 1,
            appearance: 1,
          }),
          /Simulated outbox failure/,
        );
      } finally {
        emailOutboxService.withExecutor = originalWithExecutor;
      }

      assert.equal(
        await storage.getReviewById(
          (await db
            .select({ id: schema.reviews.id })
            .from(schema.reviews)
            .where(eq(schema.reviews.userId, rollbackUser.id)))[0]?.id ?? -1,
        ),
        undefined,
      );
      const rollbackRating = await storage.getOfficialById(official.id);
      assert.equal(rollbackRating?.averageRating, baselineRating?.averageRating);
      assert.equal(rollbackRating?.totalReviews, baselineRating?.totalReviews);
      const rollbackOutbox = await db
        .select({ id: schema.emailOutbox.id })
        .from(schema.emailOutbox)
        .where(eq(schema.emailOutbox.recipientEmail, rollbackUser.email));
      assert.equal(rollbackOutbox.length, 0);

      await storage.deleteUser(pendingUser.id);
      const preservedPendingOutbox = await db
        .select()
        .from(schema.emailOutbox)
        .where(eq(schema.emailOutbox.id, pendingOutbox[0].id));
      assert.equal(preservedPendingOutbox.length, 1);
      assert.equal(preservedPendingOutbox[0].recipientUserId, null);
      assert.equal(preservedPendingOutbox[0].recipientEmail, pendingUser.email);
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
      }
      if (outboxIds.length > 0) {
        await db
          .delete(schema.emailOutbox)
          .where(inArray(schema.emailOutbox.id, outboxIds));
      }
      if (eventIds.length > 0) {
        await db
          .delete(schema.eventOfficials)
          .where(inArray(schema.eventOfficials.eventId, eventIds));
        await db
          .delete(schema.events)
          .where(inArray(schema.events.id, eventIds));
      }
      if (officialIds.length > 0) {
        await db
          .delete(schema.officials)
          .where(inArray(schema.officials.id, officialIds));
      }
      if (userIds.length > 0) {
        await db
          .delete(schema.users)
          .where(inArray(schema.users.id, userIds));
      }
    }
  },
);