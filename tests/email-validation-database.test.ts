import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { assertDevelopmentDatabase } from "./development-database-target";
import { db, pool } from "../server/db";
import * as s from "../shared/schema";
import { registerRoutes } from "../server/routes";
import { DatabasePasswordResetRateLimiter } from "../server/auth/password-reset-rate-limit";
import { PasswordResetService } from "../server/auth/password-reset";
import { AesGcmSensitiveEmailPayloadProtector } from "../server/email/sensitive-payload";
import { EmailOutboxService } from "../server/email/outbox";
import { digest } from "../server/email/validation/contracts";
import { planFixtures, createFixtures, planCapture, captureFixtures, officialBaseline, assertOwnedOutbox } from "../server/email/validation/fixtures";
import { inspectFixtures, planCleanup, cleanupFixtures } from "../server/email/validation/cleanup";
import { planSend, executeSend, planRecovery, recoverClaim } from "../server/email/validation/dispatch";
import type { EmailMessage, EmailProvider } from "../server/email/provider";

test("scoped validation lifecycle: actual Development records, fake delivery, exact ownership and cleanup",
  { skip: process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1" }, async (t) => {
    await assertDevelopmentDatabase(pool);
    const runId = randomUUID(), marker = `validation-${runId}`;
    const env = { EMAIL_VALIDATION_ENABLED: "1", EMAIL_DELIVERY_MODE: "controlled",
      EMAIL_WORKER_ENABLED: "0", SKIP_DATABASE_INITIALIZATION: "1" };
    const protector = new AesGcmSensitiveEmailPayloadProtector(Buffer.alloc(32, 62));
    const password = "FixtureValidation123!";
    const [admin] = await db.insert(s.users).values({
      email: `${marker}-admin@example.test`, password: await bcrypt.hash(password, 4),
      firstName: "Validation", lastName: runId, userType: "Admin", role: "admin", isVerified: true,
    }).returning();
    const protectedIds: number[] = [];
    for (let i = 0; i < 18; i++) {
      const [row] = await db.insert(s.officials).values({ firstName: "Protected test",
        lastName: `${runId}-${i}`, age: 30, location: "Development only",
        association: "Fixture baseline", yearsExperience: 1 }).returning();
      protectedIds.push(row.id);
    }
    const baseline = await officialBaseline(db);
    const today = formatInTimeZone(new Date(), "America/New_York", "yyyy-MM-dd");
    const next = new Date(`${today}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const plan = await planFixtures(db, {
      runId, coachEmail: `${marker}-coach@example.test`,
      alternateCoachEmail: `${marker}-alternate@example.test`,
      supervisorEmail: `${marker}-supervisor@example.test`,
      adminUserId: admin.id, adminEmail: admin.email, evaluationDay: today,
      reminderDay: next.toISOString().slice(0, 10),
      expectedProtectedOfficials: Object.keys(baseline).length,
    });
    let records: Awaited<ReturnType<typeof createFixtures>> | undefined;
    let server: any, sentinelId: number | undefined;
    const retainedOutboxIds: number[] = [];
    const sent: EmailMessage[] = [];
    let clock = new Date(Date.now() + 2000);
    const provider: EmailProvider = { send: async (message) => {
      assert.ok(message.to.startsWith(marker) && message.to.endsWith("@example.test"));
      sent.push(message); return { outcome: "success", providerMessageId: `fake-${sent.length}` };
    } };
    const context = { protector, replyTo: "reply@example.test", now: () => clock };
    const invoke = (manifest: any, chosen = provider) => executeSend(db, manifest,
      `send:${digest(manifest)}`, { ...context, env, providerFactory: () => chosen });
    const tick = () => { clock = new Date(Math.max(clock.getTime(), Date.now() + 2000)); };
    const prepare = async (rowIds: number[]) => {
      tick();
      const rows = await db.select().from(s.emailOutbox).where(inArray(s.emailOutbox.id, rowIds));
      return planSend(db, { fixtureRunId: runId, rowIds,
        recipients: Array.from(new Set(rows.map((r) => r.recipientEmail))),
        permittedTypes: Array.from(new Set(rows.map((r) => r.type))), approvedBy: "Development test operator" }, context);
    };
    const capture = async (reviewIds: number[] = [], tokenIds: number[] = []) => {
      const observed = await inspectFixtures(db, runId);
      const proposed = await planCapture(db, runId, {
        reviewIds, tokenIds, outboxIds: observed.outbox.map((r: any) => r.id),
      });
      records = await captureFixtures(db, proposed, `capture:${digest(proposed)}`, env);
      retainedOutboxIds.push(...records.outboxIds);
    };
    try {
      await t.test("dry-run creation is non-mutating; explicit approval creates only isolated fixtures", async () => {
        assert.equal((await db.select().from(s.emailValidationFixtures)
          .where(eq(s.emailValidationFixtures.runId, runId))).length, 0);
        await assert.rejects(createFixtures(db, plan, "wrong", env));
        records = await createFixtures(db, plan, `fixtures:${digest(plan)}`, env);
        retainedOutboxIds.push(...records.outboxIds);
        await assert.rejects(createFixtures(db, plan, `fixtures:${digest(plan)}`, env));
        assert.deepEqual(await officialBaseline(db, records.officialId), baseline);
      });
      assert.ok(records);
      const app = express(); app.use(express.json());
      server = await registerRoutes(app, {
        passwordResetLimiter: new DatabasePasswordResetRateLimiter(db, marker),
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      const request = (path: string, method: string, body: any, cookie?: string) =>
        fetch(base + path, { method, headers: {
          ...(body instanceof FormData || body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
      const login = async (email: string) => {
        const response = await request("/api/auth/login", "POST", { email, password });
        assert.equal(response.status, 200);
        return response.headers.get("set-cookie")!.split(";")[0];
      };
      await db.update(s.users).set({ password: await bcrypt.hash(password, 4) }).where(eq(s.users.id, records.coachId));
      const adminCookie = await login(admin.email), coachCookie = await login(plan.input.coachEmail);
      const outbox = new EmailOutboxService(db);
      const sentinel = await outbox.enqueue({ type: "event_created", recipientUserId: admin.id,
        recipientEmail: admin.email, payload: { firstName: "Unrelated", eventName: "Unrelated",
          eventStart: "Unspecified", venue: "Unrelated", assignedOfficials: [] },
        deduplicationKey: `${marker}-unrelated` });
      sentinelId = sentinel.row.id;

      await t.test("altered IDs, recipients, content and duplicate operator invocations cannot escape scope", async () => {
        const [assignment] = await db.select().from(s.emailOutbox).where(and(
          eq(s.emailOutbox.id, records!.outboxIds[0]), eq(s.emailOutbox.type, "event_created")));
        const manifest = await prepare([assignment.id]);
        const prior = sent.length;
        await assert.rejects(invoke({ ...manifest, recipients: ["attacker@example.test"] }));
        await assert.rejects(invoke({ ...manifest, rows: [{ ...manifest.rows[0], id: sentinelId }] }));
        await assert.rejects(executeSend(db, manifest, "send:wrong",
          { ...context, env, providerFactory: () => provider }));
        await db.update(s.emailOutbox).set({ payload: { ...assignment.payload, firstName: "Altered" } })
          .where(eq(s.emailOutbox.id, assignment.id));
        await assert.rejects(invoke(manifest));
        await db.update(s.emailOutbox).set({ payload: assignment.payload }).where(eq(s.emailOutbox.id, assignment.id));
        assert.equal(sent.length, prior);
        const results = await Promise.allSettled([invoke(manifest), invoke(manifest)]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(sent.length, prior + 1);
        await assert.rejects(invoke(manifest));
        const [journal] = await db.select().from(s.emailValidationAuthorizations)
          .where(eq(s.emailValidationAuthorizations.authorizationId, manifest.authorizationId));
        assert.equal(journal.attemptsUsed, 1);
        assert.equal((await outbox.getById(sentinelId!))!.status, "pending");
      });
      await t.test("HTTP evaluation sends only selected coach/admin/region copies and suppresses next-day reminder", async () => {
        const form = new FormData();
        for (const [key, value] of Object.entries({ eventId: String(records!.eventIds[0]),
          mechanics: "5", professionalism: "5", positioning: "5", stalling: "5",
          consistency: "5", appearance: "5", comment: "Private fixture evaluation" })) form.set(key, value);
        const response = await request(`/api/officials/${records!.officialId}/reviews`, "POST", form, coachCookie);
        assert.equal(response.status, 201);
        const review = await response.json() as s.Review;
        await capture([review.id]);
        const candidates = await db.select().from(s.emailOutbox).where(inArray(s.emailOutbox.id, records!.outboxIds));
        const copies = candidates.filter((r) => r.type === "evaluation_submitted" &&
          [plan.input.coachEmail, plan.input.supervisorEmail, plan.input.adminEmail].includes(r.recipientEmail));
        assert.equal(copies.length, 3);
        const confirmation = copies.find((r) => r.recipientUserId === records!.coachId)!;
        await assert.rejects(assertOwnedOutbox(db, records!, { ...confirmation, recipientUserId: admin.id }));
        const reviewer = copies.find((r) => r.recipientUserId === admin.id)!;
        await assert.rejects(assertOwnedOutbox(db, records!, { ...reviewer,
          payload: { ...reviewer.payload, reviewUrl: "/events/999999999" } }));
        await assert.rejects(assertOwnedOutbox(db, records!, { ...reviewer,
          deduplicationKey: reviewer.deduplicationKey + ":injected" }));
        const result = await invoke(await prepare(copies.map((r) => r.id)));
        assert.equal(result.reduce((sum, r) => sum + r.result.sent, 0), 3);
        assert.equal(candidates.find((r) => r.payload.reminderKind === "day_after" &&
          r.payload.eventId === records!.eventIds[0])!.status, "cancelled");
      });
      await t.test("encrypted reset is rendered through normal decryption; failures require a fresh bounded retry", async () => {
        const issued = await new PasswordResetService(db, protector, "https://trusted.example.test")
          .requestReset(plan.input.coachEmail);
        assert.ok(issued.resetRequestId);
        await capture([], [issued.resetRequestId]);
        const [reset] = await db.select().from(s.emailOutbox)
          .where(eq(s.emailOutbox.deduplicationKey, `password-reset:${issued.resetRequestId}`));
        assert.ok(reset.encryptedPayload); assert.equal(reset.payload.resetUrl, undefined);
        const manifest = await prepare([reset.id]);
        const failure: EmailProvider = { send: async () => ({
          outcome: "transient_failure", errorCode: "FAKE_UNAVAILABLE", diagnostic: "Fake provider only" }) };
        const failed = await invoke(manifest, failure);
        assert.equal(failed[0].result.retrying, 1);
        await assert.rejects(invoke(manifest));
        clock = new Date((await outbox.getById(reset.id))!.nextAttemptAt.getTime() + 1);
        assert.equal((await invoke(await prepare([reset.id])))[0].result.sent, 1);
        assert.match(sent.at(-1)!.text, /https:\/\/trusted\.example\.test\/reset-password\?token=/);
      });
      await t.test("stale exact validation claims require explicit ambiguity acknowledgement and preserve fencing", async () => {
        const candidates = await db.select().from(s.emailOutbox).where(inArray(s.emailOutbox.id, records!.outboxIds));
        const assignment = candidates.find((r) => r.type === "event_created" && r.status === "pending")!;
        const claimed = await outbox.claimExactMessage({ id: assignment.id, workerId: `validation:${randomUUID()}`,
          expectedType: assignment.type, expectedRecipientEmail: assignment.recipientEmail,
          expectedDeduplicationKey: assignment.deduplicationKey, now: clock });
        assert.ok(claimed);
        await db.update(s.emailOutbox).set({ claimedAt: new Date(Date.now() - 6 * 60_000) })
          .where(eq(s.emailOutbox.id, assignment.id));
        const recovery = await planRecovery(db, runId, assignment.id);
        await assert.rejects(recoverClaim(db, recovery, "wrong", env));
        await recoverClaim(db, recovery, `recover:${digest(recovery)}`, env);
        assert.equal(await outbox.markSent(assignment.id, "stale", claimed.claimToken!, clock), false);
        assert.equal((await invoke(await prepare([assignment.id])))[0].result.sent, 1);
      });
      await t.test("reapproval, day-of/day-after, rescheduling and deletion remain scoped", async () => {
        const form = new FormData(); form.set("email", plan.input.alternateCoachEmail);
        form.set("school", `Email validation ${runId}`);
        assert.equal((await request(`/api/admin/coaches/${records!.coachId}`, "PATCH", form, adminCookie)).status, 200);
        await capture();
        let candidates = await db.select().from(s.emailOutbox).where(inArray(s.emailOutbox.id, records!.outboxIds));
        const dayOf = candidates.find((r) => r.payload.eventId === records!.eventIds[1] &&
          r.payload.reminderKind === "day_of" && r.status === "pending")!;
        const dayAfter = candidates.find((r) => r.payload.eventId === records!.eventIds[1] &&
          r.payload.reminderKind === "day_after" && r.status === "pending")!;
        clock = new Date(dayOf.scheduledFor.getTime() + 1000);
        assert.equal((await invoke(await prepare([dayOf.id])))[0].result.sent, 1);
        assert.equal(sent.at(-1)!.to, plan.input.alternateCoachEmail);
        const suppressed = candidates.find((r) => r.payload.eventId === records!.eventIds[0] &&
          r.payload.reminderKind === "day_after" && r.status === "pending")!;
        assert.equal((await invoke(await prepare([suppressed.id])))[0].result.sent, 0);
        clock = new Date(dayAfter.scheduledFor.getTime() + 1000);
        assert.equal((await invoke(await prepare([dayAfter.id])))[0].result.sent, 1);
        const eventId = records!.eventIds[1];
        const [event] = await db.select().from(s.events).where(eq(s.events.id, eventId));
        const rescheduled = new Date(`${plan.input.reminderDay}T00:00:00Z`); rescheduled.setUTCDate(rescheduled.getUTCDate() + 5);
        const response = await request(`/api/events/${eventId}`, "PATCH", { ...event,
          date: rescheduled.toISOString().slice(0, 10), teams: [records!.teamId],
          officials: [{ officialId: records!.officialId }] }, adminCookie);
        assert.equal(response.status, 200);
        await capture();
        assert.equal((await request(`/api/events/${eventId}`, "DELETE", undefined, adminCookie)).status, 200);
        candidates = await db.select().from(s.emailOutbox).where(inArray(s.emailOutbox.id, records!.outboxIds));
        assert.ok(candidates.filter((r) => r.payload.eventId === eventId)
          .every((r) => ["sent", "cancelled"].includes(r.status)));
      });
      await t.test("cleanup rejects tampering/unrelated IDs, keeps all message history and protects the official baseline", async () => {
        const unusedReset = await new PasswordResetService(db, protector, "https://trusted.example.test")
          .requestReset(plan.input.alternateCoachEmail);
        await capture([], [unusedReset.resetRequestId!]);
        const [unrelated] = await db.insert(s.events).values({ name: "Unrelated Development fixture",
          date: new Date(), venue: "Test" }).returning();
        await db.insert(s.eventTeams).values({ eventId: unrelated.id, teamId: records!.teamId });
        await assert.rejects(planCleanup(db, runId));
        await db.delete(s.eventTeams).where(eq(s.eventTeams.eventId, unrelated.id));
        await db.delete(s.events).where(eq(s.events.id, unrelated.id));
        const stalePlan = await planCleanup(db, runId);
        // A legitimate business change to a test-owned protected stand-in must
        // invalidate this approval, but must not make fresh cleanup impossible.
        await db.update(s.officials).set({ age: 31 }).where(eq(s.officials.id, protectedIds[0]));
        await assert.rejects(cleanupFixtures(db, stalePlan, `cleanup:${digest(stalePlan)}`, env));
        Object.assign(baseline, await officialBaseline(db, records!.officialId));
        const cleanup = await planCleanup(db, runId);
        const tampered = { ...cleanup, officialId: protectedIds[0] };
        await assert.rejects(cleanupFixtures(db, tampered, `cleanup:${digest(tampered)}`, env));
        await assert.rejects(planCapture(db, runId, { reviewIds: [], tokenIds: [], outboxIds: [sentinelId!] }));
        const before = await db.select().from(s.emailOutbox).where(inArray(s.emailOutbox.id, records!.outboxIds));
        const result = await cleanupFixtures(db, cleanup, `cleanup:${digest(cleanup)}`, env);
        assert.equal(result.protectedOfficialsUnchanged, Object.keys(baseline).length);
        assert.deepEqual(await officialBaseline(db), baseline);
        const after = await db.select().from(s.emailOutbox).where(inArray(s.emailOutbox.id, records!.outboxIds));
        assert.equal(after.length, before.length);
        for (const row of before.filter((r) => ["sent", "cancelled"].includes(r.status))) {
          assert.equal(after.find((r) => r.id === row.id)!.status, row.status);
        }
        const cancelledReset = after.find((r) => r.deduplicationKey === `password-reset:${unusedReset.resetRequestId}`)!;
        assert.equal(cancelledReset.status, "cancelled");
        assert.equal(cancelledReset.encryptedPayload, "");
        assert.equal((await outbox.getById(sentinelId!))!.status, "pending");
        await assert.rejects(cleanupFixtures(db, cleanup, `cleanup:${digest(cleanup)}`, env));
      });
    } finally {
      if (server) await new Promise<void>((resolve) => server.close(resolve));
      // Test-only teardown, exact dynamically allocated IDs. The operator cleanup
      // above deliberately retained history; this removes only this test's records.
      const [run] = await db.select().from(s.emailValidationFixtures).where(eq(s.emailValidationFixtures.runId, runId));
      if (run?.state === "active") {
        const observed = await inspectFixtures(db, runId);
        try {
          const capturePlan = await planCapture(db, runId, { reviewIds: observed.reviews.map((r: any) => r.id),
            tokenIds: observed.tokens.map((r: any) => r.id), outboxIds: observed.outbox.map((r: any) => r.id) });
          records = await captureFixtures(db, capturePlan, `capture:${digest(capturePlan)}`, env);
          const cleanup = await planCleanup(db, runId);
          await cleanupFixtures(db, cleanup, `cleanup:${digest(cleanup)}`, env);
        } catch { t.diagnostic(`Cleanup refused for Development fixture ${runId}; retaining its protected baseline`); }
      }
      const [latest] = await db.select().from(s.emailValidationFixtures)
        .where(eq(s.emailValidationFixtures.runId, runId));
      if (latest?.state !== "cleaned") {
        await pool.end();
        throw new Error(`Development fixture ${runId} retained for exact-ID operator review`);
      }
      await db.delete(s.emailValidationAuthorizations).where(eq(s.emailValidationAuthorizations.fixtureRunId, runId));
      if (run?.state === "cleaned" || (await db.select().from(s.emailValidationFixtures)
        .where(eq(s.emailValidationFixtures.runId, runId)))[0]?.state === "cleaned") {
        await db.delete(s.emailValidationFixtures).where(eq(s.emailValidationFixtures.runId, runId));
      }
      const allIds = Array.from(new Set([...retainedOutboxIds, ...(records?.outboxIds ?? []), ...(sentinelId ? [sentinelId] : [])]));
      if (allIds.length) await db.delete(s.emailOutbox).where(inArray(s.emailOutbox.id, allIds));
      await db.delete(s.officials).where(inArray(s.officials.id, protectedIds));
      await db.delete(s.users).where(eq(s.users.id, admin.id));
      await pool.end();
    }
  });
