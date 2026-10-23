import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import * as s from "@shared/schema";
import { approveCoachNotificationIdentity } from "../coach-notification-identity";
import { eventDay, EVENT_TIMEZONE } from "../event-policy";
import { queueEventEmails } from "../event-notifications";
import { formatInTimeZone } from "date-fns-tz";
import { demand, digest, fixtureInput, freshWindow, ids, operatorGate,
  type FixtureInput, type FixtureRecords } from "./contracts";

export async function officialBaseline(executor: any, excludedId?: number) {
  const rows = await executor.select().from(s.officials)
    .where(excludedId ? ne(s.officials.id, excludedId) : undefined);
  return Object.fromEntries(rows.map((row: any) => [String(row.id), digest(row)]));
}
export async function loadFixture(executor: any, runId: string, allowExpired = false) {
  const [run] = await executor.select().from(s.emailValidationFixtures)
    .where(eq(s.emailValidationFixtures.runId, runId));
  demand(run?.state === "active" && (allowExpired || run.expiresAt > new Date()), "Fixture run unavailable");
  return { run, records: run.records as FixtureRecords };
}
export async function planFixtures(executor: any, input: unknown, now = new Date()) {
  const config = fixtureInput.parse(input);
  const today = formatInTimeZone(now, EVENT_TIMEZONE, "yyyy-MM-dd");
  demand(eventDay(new Date(`${config.evaluationDay}T00:00:00Z`)) === config.evaluationDay &&
    config.evaluationDay === today, "Evaluation fixture must use today's New York calendar date");
  demand(eventDay(new Date(`${config.reminderDay}T00:00:00Z`)) === config.reminderDay &&
    config.reminderDay > today, "Reminder fixture must use a valid future date");
  const [admin] = await executor.select().from(s.users).where(eq(s.users.id, config.adminUserId));
  demand(admin?.role === "admin" && admin.isVerified === true && admin.email === config.adminEmail,
    "Administrative recipient must match an existing approved administrator");
  const baseline = await officialBaseline(executor);
  demand(Object.keys(baseline).length === config.expectedProtectedOfficials,
    "Protected official inventory changed");
  const collisions = await executor.select({ id: s.users.id }).from(s.users)
    .where(inArray(s.users.email, [config.coachEmail, config.alternateCoachEmail, config.supervisorEmail]));
  demand(!collisions.length, "Disposable addresses must not belong to existing users");
  return { kind: "fixtures" as const, input: config, protectedOfficials: baseline,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() };
}
export async function createFixtures(executor: any, plan: Awaited<ReturnType<typeof planFixtures>>,
  acknowledgement: string, env = process.env) {
  operatorGate("fixtures", plan, acknowledgement, env);
  freshWindow(plan.createdAt, plan.expiresAt, new Date());
  demand(digest(await planFixtures(executor, plan.input, new Date(plan.createdAt))) === digest(plan),
    "Fixture plan changed; obtain a new dry-run approval");
  return executor.transaction(async (tx: any) => {
    const input = plan.input, label = `Email validation ${input.runId}`;
    const region = `EMAIL-VALIDATION:${input.runId}`;
    // Insert the run first: concurrent/repeated creation of the same run is rejected atomically.
    await tx.insert(s.emailValidationFixtures).values({
      runId: input.runId, state: "creating", records: {},
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    demand(digest(await officialBaseline(tx)) === digest(plan.protectedOfficials), "Official baseline changed");
    const [team] = await tx.insert(s.teams).values({ name: label, region }).returning();
    // Unknown random password; no plaintext credential or reset token in the manifest.
    const password = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
    const [coach] = await tx.insert(s.users).values({
      email: input.coachEmail, password, firstName: "Email validation", lastName: input.runId,
      userType: "Coach", role: "user", school: label, region, isVerified: true,
    }).returning();
    const [supervisor] = await tx.insert(s.users).values({
      email: input.supervisorEmail, password, firstName: "Email validation", lastName: input.runId,
      userType: "Regional Supervisor", role: "user", region, isVerified: true,
    }).returning();
    const [official] = await tx.insert(s.officials).values({
      firstName: "Email validation", lastName: input.runId, age: 30,
      location: label, association: region, yearsExperience: 1,
    }).returning();
    await approveCoachNotificationIdentity(tx, coach);
    const eventIds: number[] = [];
    for (let index = 0; index < 2; index++) {
      const day = [input.evaluationDay, input.reminderDay][index];
      const [event] = await tx.insert(s.events).values({
        name: `${label} ${index}`, date: new Date(`${day}T00:00:00Z`),
        startTime: "10:00", venue: label, eventType: "Dual", region,
      }).returning();
      eventIds.push(event.id);
      await tx.insert(s.eventTeams).values({ eventId: event.id, teamId: team.id });
      await tx.insert(s.eventOfficials).values({ eventId: event.id, officialId: official.id });
      await queueEventEmails(tx, event.id);
    }
    const outbox = await tx.select({ id: s.emailOutbox.id }).from(s.emailOutbox)
      .where(eq(s.emailOutbox.recipientUserId, coach.id));
    const records: FixtureRecords = { input, teamId: team.id, coachId: coach.id,
      supervisorId: supervisor.id, officialId: official.id, eventIds,
      reviewIds: [], tokenIds: [], outboxIds: outbox.map((r: any) => r.id),
      protectedOfficials: plan.protectedOfficials };
    await tx.update(s.emailValidationFixtures).set({ state: "active", records })
      .where(eq(s.emailValidationFixtures.runId, input.runId));
    return records;
  });
}

export function approvedRecipients(records: FixtureRecords) {
  return [records.input.coachEmail, records.input.alternateCoachEmail,
    records.input.supervisorEmail, records.input.adminEmail];
}
export async function assertOwnedOutbox(executor: any, records: FixtureRecords, row: s.EmailOutbox) {
  const eventId = row.payload.eventId;
  if (["event_created", "event_reminder"].includes(row.type)) {
    demand(records.eventIds.includes(Number(eventId)) && row.recipientUserId === records.coachId,
      "Not a fixture event message");
  } else if (row.type === "password_reset") {
    const tokenId = Number(/^password-reset:(\d+)$/.exec(row.deduplicationKey)?.[1]);
    demand(records.tokenIds.includes(tokenId) && row.recipientUserId === records.coachId,
      "Not a captured fixture reset message");
  } else if (row.type === "evaluation_submitted") {
    const confirmation = /^evaluation-submitted:(\d+)$/.exec(row.deduplicationKey);
    const reviewer = /^evaluation-reviewer:(\d+):(\d+)$/.exec(row.deduplicationKey);
    const reviewId = Number(confirmation?.[1] ?? reviewer?.[1]);
    demand(records.reviewIds.includes(reviewId), "Not a captured fixture evaluation");
    const [review] = await executor.select().from(s.reviews).where(eq(s.reviews.id, reviewId));
    demand(!review || (review.userId === records.coachId && review.officialId === records.officialId &&
      records.eventIds.includes(review.eventId)), "Evaluation is not fixture-owned");
    demand(row.payload.officialName === `Email validation ${records.input.runId}` &&
      typeof row.payload.eventName === "string" &&
      row.payload.eventName.startsWith(`Email validation ${records.input.runId} `),
    "Evaluation template context is not fixture-owned");
    if (confirmation) {
      demand(row.recipientUserId === records.coachId && row.payload.audience !== "reviewer" &&
        [records.input.coachEmail, records.input.alternateCoachEmail].includes(row.recipientEmail),
      "Confirmation is not addressed to the fixture coach");
    } else {
      const [recipient] = await executor.select().from(s.users)
        .where(eq(s.users.id, Number(reviewer![2])));
      demand(recipient && row.recipientUserId === recipient.id && row.recipientEmail === recipient.email &&
        recipient.isVerified && (recipient.role === "admin" ||
          (recipient.id === records.supervisorId && recipient.userType === "Regional Supervisor" &&
           recipient.region === `EMAIL-VALIDATION:${records.input.runId}`)),
      "Reviewer recipient/approval/region does not match fixture review");
      demand(row.payload.audience === "reviewer" &&
        (review ? row.payload.reviewUrl === `/events/${review.eventId}` :
          records.eventIds.some((id) => row.payload.reviewUrl === `/events/${id}`)),
      "Reviewer link does not match the fixture event");
    }
  } else { throw new Error("Message type not permitted in fixture validation"); }
}

export async function planCapture(executor: any, runId: string,
  requested: { reviewIds: number[]; tokenIds: number[]; outboxIds: number[] }) {
  const { records } = await loadFixture(executor, runId);
  for (const list of Object.values(requested)) ids.parse(list);
  const next = { ...records, reviewIds: Array.from(new Set([...records.reviewIds, ...requested.reviewIds])),
    tokenIds: Array.from(new Set([...records.tokenIds, ...requested.tokenIds])),
    outboxIds: Array.from(new Set([...records.outboxIds, ...requested.outboxIds])) };
  for (const id of requested.reviewIds) {
    const [row] = await executor.select().from(s.reviews).where(eq(s.reviews.id, id));
    demand(row && row.userId === records.coachId && row.officialId === records.officialId &&
      records.eventIds.includes(row.eventId), "Review is not exclusively fixture-owned");
  }
  for (const id of requested.tokenIds) {
    const [row] = await executor.select().from(s.passwordResetTokens).where(eq(s.passwordResetTokens.id, id));
    demand(row?.userId === records.coachId, "Token does not belong to the fixture coach");
  }
  for (const id of requested.outboxIds) {
    const [row] = await executor.select().from(s.emailOutbox).where(eq(s.emailOutbox.id, id));
    demand(row, "Outbox row missing");
    await assertOwnedOutbox(executor, next, row);
  }
  return { kind: "capture" as const, runId, requested, before: digest(records), records: next };
}
export async function captureFixtures(executor: any, plan: Awaited<ReturnType<typeof planCapture>>,
  acknowledgement: string, env = process.env) {
  operatorGate("capture", plan, acknowledgement, env);
  return executor.transaction(async (tx: any) => {
    await tx.select().from(s.emailValidationFixtures).where(eq(s.emailValidationFixtures.runId, plan.runId)).for("update");
    demand(digest(await planCapture(tx, plan.runId, plan.requested)) === digest(plan), "Capture plan changed");
    await tx.update(s.emailValidationFixtures).set({ records: plan.records })
      .where(eq(s.emailValidationFixtures.runId, plan.runId));
    return plan.records;
  });
}
