import assert from "node:assert/strict";
import { assertDevelopmentDatabase } from "./development-database-target";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import bcrypt from "bcryptjs";
import { and, eq, inArray, like } from "drizzle-orm";
import * as schema from "../shared/schema";
import { db, pool } from "../server/db";
import { registerRoutes } from "../server/routes";
import { storage } from "../server/storage";
import { DatabasePasswordResetRateLimiter } from "../server/auth/password-reset-rate-limit";
import { EmailOutboxService, type ClaimOptions } from "../server/email/outbox";
import { EmailDeliveryWorker } from "../server/email/worker";
import { EmailDeliveryPolicy } from "../server/email/policy";
import type { EmailMessage, EmailProvider } from "../server/email/provider";
import { AesGcmSensitiveEmailPayloadProtector } from "../server/email/sensitive-payload";
import { reminderTimes } from "../server/email/event-policy";

// Never let simulated future time or fake workers touch historical outbox rows.
class FixtureOutbox extends EmailOutboxService {
  constructor(private readonly ids: number[]) { super(db); }
  override async recoverStaleClaims() { return 0; }
  override async cancelExpiredMessages() { return 0; }
  override async claimDueMessages(options: ClaimOptions) {
    const result: schema.EmailOutbox[] = [];
    for (const id of this.ids) {
      const row = await this.getById(id);
      if (!row) continue;
      const claimed = await this.claimExactMessage({
        id, workerId: options.workerId, now: options.now,
        expectedType: row.type, expectedRecipientEmail: row.recipientEmail,
        expectedDeduplicationKey: row.deduplicationKey,
      });
      if (claimed) result.push(claimed);
    }
    return result;
  }
}

test("HTTP/database email lifecycle with fake delivery and durable scheduling",
  { skip: process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1" }, async (t) => {
    await assertDevelopmentDatabase(pool);
    const marker = `email-lifecycle-${process.pid}-${Date.now()}`;
    const userIds: number[] = [], teamIds: number[] = [], officialIds: number[] = [], eventIds: number[] = [];
    const key = Buffer.alloc(32, 53);
    const originalKey = process.env.EMAIL_SENSITIVE_PAYLOAD_KEY;
    const originalUrl = process.env.APP_URL;
    process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = key.toString("base64");
    process.env.APP_URL = "https://trusted.example.test";
    const protector = new AesGcmSensitiveEmailPayloadProtector(key);
    const sent: EmailMessage[] = [];
    const provider: EmailProvider = {
      send: async (message) => {
        assert.ok(message.to.startsWith(marker), "fake delivery must target a disposable account");
        assert.match(message.to, /@example\.test$/);
        sent.push(message);
        return { outcome: "success", providerMessageId: `fake-${sent.length}` };
      },
    };
    let clock = new Date();
    const worker = (ids: number[], selectedProvider = provider) => new EmailDeliveryWorker(
      new FixtureOutbox(ids), selectedProvider, {
        workerId: `${marker}-${Math.random()}`, now: () => clock,
        policy: new EmailDeliveryPolicy({ mode: "live" }), // Injected fake only; no environment change.
        sensitivePayloadProtector: protector,
        log: { info() {}, warn() {}, error() {} },
      });
    const createUser = async (suffix: string, overrides: Partial<schema.User> = {}) => {
      const [user] = await db.insert(schema.users).values({
        firstName: "Fixture", lastName: suffix, email: `${marker}-${suffix}@example.test`,
        password: await bcrypt.hash("FixturePassword1!", 4),
        userType: "Coach", role: "user", region: "East", isVerified: true,
        ...overrides,
      }).returning();
      userIds.push(user.id);
      return user;
    };
    const [team] = await db.insert(schema.teams).values({ name: `${marker}-team`, region: "East" }).returning();
    teamIds.push(team.id);
    const admin = await createUser("admin", { role: "admin" });
    const coach = await createUser("coach", { school: team.name });
    const east = await createUser("east", { userType: "Regional Supervisor" });
    const west = await createUser("west", { userType: "Regional Supervisor", region: "West" });
    const nullRegion = await createUser("null", { userType: "Regional Supervisor", region: null });
    await createUser("unverified", { school: team.name, isVerified: false });
    await createUser("wrong-region", { school: team.name, region: "West" });
    const derivedCoach = await createUser("derived-region", { school: team.name, region: null });
    const [official] = await db.insert(schema.officials).values({
      firstName: "Official", lastName: "Fixture", age: 30, location: "Test",
      association: "East", yearsExperience: 4,
    }).returning();
    officialIds.push(official.id);
    const app = express();
    app.use(express.json());
    const limiter = new DatabasePasswordResetRateLimiter(db, marker);
    const server = await registerRoutes(app, { passwordResetLimiter: limiter });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (path: string, method = "GET", body?: unknown, cookie?: string) =>
      fetch(base + path, {
        method, headers: {
          ...(body instanceof FormData ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    const login = async (user: schema.User, password = "FixturePassword1!") => {
      const response = await request("/api/auth/login", "POST", { email: user.email, password });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const adminCookie = await login(admin), coachCookie = await login(coach);
    for (const account of [coach, derivedCoach]) {
      assert.equal((await request(`/api/users/${account.id}/verify`, "POST",
        { approved: true }, adminCookie)).status, 200);
    }
    const eventInput = (date: string) => ({
      name: `${marker}-event`, date, startTime: "14:30", venue: "Test Gym",
      eventType: "Tournament", region: "East", officials: [{ officialId: official.id }],
      teams: [team.id], recipientEmail: "attacker@example.test",
    });
    const eventRows = async (id: number) => (await db.select().from(schema.emailOutbox))
      .filter((row) => row.payload.eventId === id);
    try {
      await t.test("registration, approval and rejection preserve cancellation and deliver through fake providers", async () => {
        for (const approved of [true, false]) {
          const email = `${marker}-registration-${approved}@example.test`;
          const form = new FormData();
          for (const [field, value] of Object.entries({
            firstName: "Fixture", lastName: "Registration", email,
            password: "FixturePassword1!", confirmPassword: "FixturePassword1!",
            userType: "Coach", school: team.name, yearsCoaching: "2",
          })) form.set(field, value);
          const response = await request("/api/auth/register", "POST", form);
          assert.equal(response.status, 201);
          const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
          userIds.push(user.id);
          // Registration does not accept a trusted region; assign as an admin
          // fixture would before approving the account.
          await db.update(schema.users).set({ region: "East" }).where(eq(schema.users.id, user.id));
          let rows = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.recipientEmail, email));
          if (approved) {
            clock = new Date(Date.now() + 1000);
            assert.equal((await worker(rows.map((r) => r.id)).runOnce()).sent, 1);
          }
          assert.equal((await request(`/api/users/${user.id}/verify`, "POST", { approved }, adminCookie)).status, 200);
          rows = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.recipientEmail, email));
          assert.equal(rows.find((r) => r.type === "registration_received")!.status, approved ? "sent" : "cancelled");
          clock = new Date(Date.now() + 1000);
          assert.equal((await worker(rows.map((r) => r.id)).runOnce()).sent, 1);
        }
      });

      await t.test("event assignment routes enforce permissions, recipients, transaction rollback and durable dedup", async () => {
        const input = eventInput("2027-03-14");
        assert.equal((await request("/api/events", "POST", input)).status, 401);
        assert.equal((await request("/api/events", "POST", input, coachCookie)).status, 403);
        const response = await request("/api/events", "POST", input, adminCookie);
        assert.equal(response.status, 201);
        const event = await response.json() as schema.Event;
        eventIds.push(event.id);
        let rows = await eventRows(event.id);
        assert.equal(rows.length, 9); // Primary, derived-region and newly approved coaches.
        assert.ok(rows.every((r) => [coach.id, derivedCoach.id].includes(r.recipientUserId!) ||
          r.recipientEmail.includes("registration-true")));
        assert.ok(rows.every((r) => !r.recipientEmail.includes("attacker")));
        const dayOf = rows.find((r) => r.payload.reminderKind === "day_of")!;
        assert.equal(dayOf.scheduledFor.toISOString(), "2027-03-14T12:00:00.000Z");
        const before = rows.length;
        assert.equal((await request(`/api/events/${event.id}`, "PATCH", input, adminCookie)).status, 200);
        assert.equal((await eventRows(event.id)).length, before);
        // Two workers race on exactly one disposable row, never the global queue.
        const assigned = rows.find((r) => r.type === "event_created" && r.recipientUserId === coach.id)!;
        clock = new Date(Date.now() + 1000);
        const results = await Promise.all([worker([assigned.id]).runOnce(), worker([assigned.id]).runOnce()]);
        assert.equal(results.reduce((n, r) => n + r.sent, 0), 1);
        assert.equal((await worker([assigned.id]).runOnce()).sent, 0);
        // Invalid relationship inserts roll back event and outbox together.
        const invalid = { ...input, name: `${marker}-rollback`, teams: [2_000_000_001] };
        await request("/api/events", "POST", invalid, adminCookie);
        assert.equal((await db.select().from(schema.events).where(eq(schema.events.name, invalid.name))).length, 0);
        const originalEnqueue = EmailOutboxService.prototype.enqueue;
        EmailOutboxService.prototype.enqueue = async function (input) {
          if (input.type === "event_created") throw new Error("Fixture outbox failure");
          return originalEnqueue.call(this, input);
        };
        try {
          const failed = { ...input, name: `${marker}-outbox-rollback` };
          assert.equal((await request("/api/events", "POST", failed, adminCookie)).status, 500);
          assert.equal((await db.select().from(schema.events).where(eq(schema.events.name, failed.name))).length, 0);
        } finally {
          EmailOutboxService.prototype.enqueue = originalEnqueue;
        }
        // Updates cancel old reminders, keep sent history, and reschedule in EST.
        assert.equal((await request(`/api/events/${event.id}`, "PATCH",
          { ...input, date: "2027-11-07" }, adminCookie)).status, 200);
        rows = await eventRows(event.id);
        assert.equal(rows.find((r) => r.id === assigned.id)!.status, "sent");
        assert.equal(rows.find((r) => r.id === dayOf.id)!.status, "cancelled");
        assert.ok(rows.some((r) => r.status === "pending" && r.payload.reminderKind === "day_of" &&
          r.scheduledFor.toISOString() === "2027-11-07T13:00:00.000Z"));
        assert.equal((await request(`/api/events/${event.id}`, "DELETE", undefined, adminCookie)).status, 200);
        assert.ok((await eventRows(event.id)).every((r) => ["sent", "cancelled"].includes(r.status)));
      });

      await t.test("HTTP evaluation confirmation notifies only admins/region supervisors and cancels next-day follow-up", async () => {
        const input = eventInput(new Date().toISOString().slice(0, 10));
        const response = await request("/api/events", "POST", input, adminCookie);
        assert.equal(response.status, 201);
        const event = await response.json() as schema.Event;
        eventIds.push(event.id);
        const reviewForm = () => {
          const form = new FormData();
          for (const [field, value] of Object.entries({
            eventId: String(event.id), mechanics: "5", professionalism: "5",
            positioning: "5", stalling: "5", consistency: "5", appearance: "5",
            comment: "PRIVATE_REVIEW_COMMENT", recipientEmail: "attacker@example.test",
          })) form.set(field, value);
          return form;
        };
        const submissions = await Promise.all([
          request(`/api/officials/${official.id}/reviews`, "POST", reviewForm(), coachCookie),
          request(`/api/officials/${official.id}/reviews`, "POST", reviewForm(), coachCookie),
        ]);
        assert.equal(submissions.filter((r) => r.status === 201).length, 1);
        assert.equal(submissions.filter((r) => r.status === 400).length, 1);
        const [review] = await db.select().from(schema.reviews).where(and(
          eq(schema.reviews.userId, coach.id), eq(schema.reviews.eventId, event.id)));
        const copies = (await db.select().from(schema.emailOutbox))
          .filter((r) => r.deduplicationKey.startsWith(`evaluation-reviewer:${review.id}:`));
        assert.ok(copies.some((r) => r.recipientUserId === admin.id));
        assert.ok(copies.some((r) => r.recipientUserId === east.id));
        assert.ok(!copies.some((r) => r.recipientUserId === west.id || r.recipientUserId === nullRegion.id));
        assert.ok(copies.every((r) => !JSON.stringify(r.payload).includes("PRIVATE_REVIEW_COMMENT")));
        const confirmation = (await db.select().from(schema.emailOutbox))
          .find((r) => r.deduplicationKey === `evaluation-submitted:${review.id}`)!;
        assert.equal(confirmation.recipientEmail, coach.email);
        const duplicate = await request(`/api/officials/${official.id}/reviews`, "POST", reviewForm(), coachCookie);
        assert.notEqual(duplicate.status, 201);
        const [rated] = await db.select().from(schema.officials).where(eq(schema.officials.id, official.id));
        assert.equal(rated.totalReviews, 1); assert.equal(rated.averageRating, 5);
        const nextDay = (await eventRows(event.id)).find((r) =>
          r.recipientUserId === coach.id && r.payload.reminderKind === "day_after")!;
        assert.equal(nextDay.status, "cancelled");
        clock = new Date(Date.now() + 1000);
        assert.equal((await worker([confirmation.id, ...copies.filter((r) => userIds.includes(r.recipientUserId!)).map((r) => r.id)]).runOnce()).sent, 3);
      });

      await t.test("self-service school/email edits cannot establish event recipients; managers can reapprove", async () => {
        const [otherTeam] = await db.insert(schema.teams)
          .values({ name: `${marker}-other-team`, region: "East" }).returning();
        teamIds.push(otherTeam.id);
        const profile = new FormData();
        profile.set("school", otherTeam.name);
        profile.set("email", `${marker}-redirected@example.test`);
        const edited = await request("/api/users/profile", "PUT", profile, coachCookie);
        assert.equal(edited.status, 200);
        assert.equal((await db.select().from(schema.coachNotificationIdentities)
          .where(eq(schema.coachNotificationIdentities.userId, coach.id))).length, 0);
        const response = await request("/api/events", "POST",
          { ...eventInput("2027-03-16"), teams: [otherTeam.id] }, adminCookie);
        assert.equal(response.status, 201);
        const event = await response.json() as schema.Event;
        eventIds.push(event.id);
        assert.equal((await eventRows(event.id)).length, 0);
        const listing = await request("/api/admin/coaches", "GET", undefined, adminCookie);
        const listed = await listing.json() as Array<schema.User & { eventEmailsApproved: boolean }>;
        assert.equal(listed.find((u) => u.id === coach.id)!.eventEmailsApproved, false);
        const restore = new FormData();
        restore.set("school", team.name);
        restore.set("email", coach.email);
        // Merely changing back is not sufficient.
        assert.equal((await request("/api/users/profile", "PUT", restore, coachCookie)).status, 200);
        assert.equal((await db.select().from(schema.coachNotificationIdentities)
          .where(eq(schema.coachNotificationIdentities.userId, coach.id))).length, 0);
        assert.equal((await request(`/api/admin/coaches/${coach.id}`, "PATCH",
          restore, adminCookie)).status, 200);
        assert.equal((await db.select().from(schema.coachNotificationIdentities)
          .where(eq(schema.coachNotificationIdentities.userId, coach.id))).length, 1);
      });

      await t.test("authorized reapproval rebuilds future reminders at the new address without changing sent history", async () => {
        const response = await request("/api/events", "POST", eventInput("2027-03-20"), adminCookie);
        assert.equal(response.status, 201);
        const event = await response.json() as schema.Event;
        eventIds.push(event.id);
        const oldRows = (await eventRows(event.id)).filter((r) => r.recipientUserId === coach.id);
        const oldAssignment = oldRows.find((r) => r.type === "event_created")!;
        clock = new Date(Date.now() + 1000);
        assert.equal((await worker([oldAssignment.id]).runOnce()).sent, 1);
        const address = `${marker}-reapproved@example.test`;
        const form = new FormData();
        form.set("email", address); form.set("school", team.name);
        assert.equal((await request("/api/users/profile", "PUT", form, coachCookie)).status, 200);
        const westCookie = await login(west), eastCookie = await login(east);
        assert.equal((await request(`/api/supervisor/coaches/${coach.id}`, "PATCH",
          form, westCookie)).status, 403);
        assert.equal((await db.select().from(schema.coachNotificationIdentities)
          .where(eq(schema.coachNotificationIdentities.userId, coach.id))).length, 0);
        assert.equal((await request(`/api/supervisor/coaches/${coach.id}`, "PATCH",
          form, eastCookie)).status, 200);
        const newRows = (await eventRows(event.id)).filter((r) => r.recipientEmail === address);
        assert.equal(newRows.length, 3);
        assert.equal((await request(`/api/supervisor/coaches/${coach.id}`, "PATCH",
          form, eastCookie)).status, 200); // No-op reapproval preserves identity/dedup keys.
        assert.equal((await eventRows(event.id)).filter((r) => r.recipientEmail === address).length, 3);
        const reminders = newRows.filter((r) => r.type === "event_reminder");
        const dayOf = reminders.find((r) => r.payload.reminderKind === "day_of")!;
        const nextDay = reminders.find((r) => r.payload.reminderKind === "day_after")!;
        clock = new Date(dayOf.scheduledFor.getTime() + 1000);
        assert.equal((await worker(reminders.map((r) => r.id)).runOnce()).sent, 1);
        assert.equal(sent.at(-1)!.to, address);
        clock = new Date(nextDay.scheduledFor.getTime() + 1000);
        assert.equal((await worker(reminders.map((r) => r.id)).runOnce()).sent, 1);
        assert.equal(sent.at(-1)!.to, address);
        assert.equal((await eventRows(event.id)).find((r) => r.id === oldAssignment.id)!.status, "sent");
        assert.ok((await eventRows(event.id)).filter((r) => oldRows.some((old) =>
          old.id === r.id && old.type === "event_reminder")).every((r) => r.status === "cancelled"));
        form.set("email", coach.email);
        assert.equal((await request(`/api/admin/coaches/${coach.id}`, "PATCH", form, adminCookie)).status, 200);
      });

      await t.test("day-of/day-after fake delivery is restart-safe and eligibility is checked again at dispatch", async () => {
        const input = eventInput("2027-03-15");
        const response = await request("/api/events", "POST", input, adminCookie);
        assert.equal(response.status, 201);
        const event = await response.json() as schema.Event;
        eventIds.push(event.id);
        const rows = (await eventRows(event.id)).filter((r) => r.recipientUserId === coach.id);
        const assigned = rows.find((r) => r.type === "event_created")!;
        const fenceOutbox = new FixtureOutbox([assigned.id]);
        fenceOutbox.isMessageEligible = async (row, now) => {
          const eligible = await EmailOutboxService.prototype.isMessageEligible.call(fenceOutbox, row, now);
          // A concurrent event/review transaction cancels after the eligibility
          // SELECT but before final dispatch authorization.
          await fenceOutbox.cancelClaim(row.id, row.claimToken!, now);
          return eligible;
        };
        clock = new Date(Date.now() + 1000);
        const callsBefore = sent.length;
        const fenced = new EmailDeliveryWorker(fenceOutbox, provider, {
          workerId: `${marker}-fence`, now: () => clock,
          policy: new EmailDeliveryPolicy({ mode: "live" }),
          log: { info() {}, warn() {}, error() {} },
        });
        assert.equal((await fenced.runOnce()).sent, 0);
        assert.equal(sent.length, callsBefore);
        const dayOf = rows.find((r) => r.payload.reminderKind === "day_of")!;
        const after = rows.find((r) => r.payload.reminderKind === "day_after")!;
        clock = new Date(dayOf.scheduledFor.getTime() - 1);
        assert.equal((await worker([dayOf.id]).runOnce()).claimed, 0);
        clock = dayOf.scheduledFor;
        assert.equal((await worker([dayOf.id]).runOnce()).sent, 1);
        clock = after.scheduledFor;
        assert.equal((await worker([after.id]).runOnce()).sent, 1);
        assert.equal((await worker([after.id]).runOnce()).claimed, 0);
        const other = (await eventRows(event.id)).find((r) =>
          r.payload.reminderKind === "day_after" && r.recipientUserId !== coach.id)!;
        await db.update(schema.users).set({ isVerified: false })
          .where(eq(schema.users.id, other.recipientUserId!));
        assert.equal((await worker([other.id]).runOnce()).sent, 0);
        assert.equal((await new EmailOutboxService(db).getById(other.id))!.status, "cancelled");
      });

      await t.test("concurrent approval and assignment do not miss or duplicate coach notifications", async () => {
        const account = await createUser("approval-race", { school: team.name, isVerified: false });
        const [assignment, approval] = await Promise.all([
          request("/api/events", "POST", eventInput("2027-04-10"), adminCookie),
          request(`/api/users/${account.id}/verify`, "POST", { approved: true }, adminCookie),
        ]);
        assert.equal(assignment.status, 201); assert.equal(approval.status, 200);
        const event = await assignment.json() as schema.Event;
        eventIds.push(event.id);
        assert.equal((await eventRows(event.id)).filter((r) => r.recipientUserId === account.id).length, 3);
        assert.equal((await request(`/api/users/${account.id}/verify`, "POST",
          { approved: true }, adminCookie)).status, 200);
        assert.equal((await eventRows(event.id)).filter((r) => r.recipientUserId === account.id).length, 3);
      });

      await t.test("shared rate limits remain atomic across instances and expire", async () => {
        const second = new DatabasePasswordResetRateLimiter(db, marker);
        const now = new Date();
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
          (i % 2 ? limiter : second).allow("email", `${marker}-limit`, 3, 1000, now)));
        assert.equal(results.filter(Boolean).length, 3);
        assert.equal(await second.allow("email", `${marker}-limit`, 3, 1000, new Date(now.getTime() + 1000)), true);
      });

      await t.test("forgot/reset HTTP flow decrypts only for fake delivery and invalidates old sessions", async () => {
        const unknown = await request("/api/auth/forgot-password", "POST", { email: `${marker}-missing@example.test` });
        const known = await request("/api/auth/forgot-password", "POST", { email: coach.email });
        assert.deepEqual(await unknown.json(), await known.json());
        const [row] = await db.select().from(schema.emailOutbox)
          .where(and(eq(schema.emailOutbox.recipientUserId, coach.id), eq(schema.emailOutbox.type, "password_reset")));
        assert.ok(row.encryptedPayload);
        assert.doesNotMatch(JSON.stringify(row.payload), /resetUrl|token/);
        clock = new Date(Date.now() + 1000);
        assert.equal((await worker([row.id]).runOnce()).sent, 1);
        const delivered = sent.at(-1)!;
        const url = /https:\/\/trusted\.example\.test\/reset-password\?token=[A-Za-z0-9_-]+/.exec(delivered.text)![0];
        const token = new URL(url).searchParams.get("token")!;
        const reset = await request("/api/auth/reset-password", "POST", { token, newPassword: "NewFixturePassword1!" });
        assert.equal(reset.status, 200);
        assert.equal((await request("/api/auth/me", "GET", undefined, coachCookie)).status, 401);
        await login(coach, "NewFixturePassword1!");
        assert.equal((await request("/api/auth/reset-password", "POST",
          { token, newPassword: "NewFixturePassword1!" })).status, 400);
      });

      await t.test("fake provider failure retries without duplicate dispatch or historical queue access", async () => {
        clock = new Date();
        const service = new EmailOutboxService(db);
        const { row } = await service.enqueue({ type: "account_approved", recipientUserId: coach.id,
          recipientEmail: coach.email, payload: { firstName: coach.firstName },
          deduplicationKey: `${marker}:retry`, scheduledFor: clock, maxAttempts: 2 });
        let attempts = 0;
        const retryProvider: EmailProvider = {
          send: async (message) => ++attempts === 1
            ? { outcome: "transient_failure", errorCode: "TEST_TRANSIENT", diagnostic: "Simulated" }
            : provider.send(message),
        };
        assert.equal((await worker([row.id], retryProvider).runOnce()).retrying, 1);
        assert.equal((await worker([row.id], retryProvider).runOnce()).claimed, 0);
        clock = new Date(clock.getTime() + 31_000);
        assert.equal((await worker([row.id], retryProvider).runOnce()).sent, 1);
        assert.equal((await worker([row.id], retryProvider).runOnce()).sent, 0);
        assert.equal(attempts, 2);
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const fixtureReviews = await db.select({ id: schema.reviews.id })
        .from(schema.reviews).where(inArray(schema.reviews.userId, userIds));
      for (const review of fixtureReviews) {
        await pool.query("DELETE FROM email_outbox WHERE deduplication_key LIKE $1",
          [`evaluation-reviewer:${review.id}:%`]);
      }
      await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.recipientEmail, `${marker}-%`));
      await db.delete(schema.passwordResetRateLimits).where(like(schema.passwordResetRateLimits.keyHash, `${marker}:%`));
      await db.delete(schema.passwordResetTokens).where(inArray(schema.passwordResetTokens.userId, userIds));
      await db.delete(schema.reviews).where(inArray(schema.reviews.userId, userIds));
      await db.delete(schema.events).where(inArray(schema.events.id, eventIds));
      await db.delete(schema.officials).where(inArray(schema.officials.id, officialIds));
      await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      if (originalKey === undefined) delete process.env.EMAIL_SENSITIVE_PAYLOAD_KEY;
      else process.env.EMAIL_SENSITIVE_PAYLOAD_KEY = originalKey;
      if (originalUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = originalUrl;
      await pool.end();
    }
  });
