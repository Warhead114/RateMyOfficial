import { createHash } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import * as schema from "@shared/schema";
import { EmailOutboxService } from "./outbox";
import { EVENT_TIMEZONE, eventCoaches, eventDay, eventStartLabel, reminderTimes } from "./event-policy";

export async function eventFingerprint(executor: any, id: number): Promise<string> {
  const [event] = await executor.select().from(schema.events).where(eq(schema.events.id, id));
  const teams = await executor.select({ id: schema.eventTeams.teamId }).from(schema.eventTeams)
    .where(eq(schema.eventTeams.eventId, id));
  const officials = await executor.select({ id: schema.eventOfficials.officialId, role: schema.eventOfficials.role })
    .from(schema.eventOfficials).where(eq(schema.eventOfficials.eventId, id));
  return createHash("sha256").update(JSON.stringify({
    name: event.name, date: event.date, startTime: event.startTime, venue: event.venue,
    region: event.region,
    teams: teams.map((t: any) => t.id).sort((a: number, b: number) => a - b),
    officials: officials.sort((a: any, b: any) => a.id - b.id),
  })).digest("hex");
}

export async function cancelEventEmails(executor: any, eventId: number, now = new Date()) {
  // Processing rows are fenced too; a provider call already accepted cannot be
  // recalled. Sent/failed/cancelled history is never deleted or rewritten.
  await executor.update(schema.emailOutbox).set({
    status: "cancelled", claimedAt: null, claimedBy: null, claimToken: null,
    updatedAt: now, lastErrorCode: "EVENT_CHANGED",
    lastError: "Event notification no longer eligible",
  }).where(and(
    inArray(schema.emailOutbox.type, ["event_created", "event_reminder"]),
    inArray(schema.emailOutbox.status, ["pending", "retry_wait", "processing"]),
    sql`${schema.emailOutbox.payload}->>'eventId' = ${String(eventId)}`,
  ));
}

export async function queueEventEmails(executor: any, eventId: number,
  previousFingerprint?: string, now = new Date()) {
  if (previousFingerprint && previousFingerprint === await eventFingerprint(executor, eventId)) return;
  // Serialize assignment and approval on the trusted team, before outbox locks.
  // NO KEY UPDATE is compatible with foreign-key checks on assignment inserts.
  await executor.select({ id: schema.teams.id }).from(schema.teams)
    .innerJoin(schema.eventTeams, eq(schema.eventTeams.teamId, schema.teams.id))
    .where(eq(schema.eventTeams.eventId, eventId)).orderBy(schema.teams.id)
    .for("no key update", { of: schema.teams });
  await cancelEventEmails(executor, eventId, now);
  const [event] = await executor.update(schema.events)
    .set({ notificationVersion: sql`${schema.events.notificationVersion} + 1` })
    .where(eq(schema.events.id, eventId)).returning();
  await queueForRecipients(executor, event, await eventCoaches(executor, eventId), now);
}

async function queueForRecipients(executor: any, event: schema.Event,
  recipients: any[], now: Date, assignment = true) {
  const eventId = event.id;
  const eventStart = eventStartLabel(event.date, event.startTime);
  const officials = await executor.select({ first: schema.officials.firstName, last: schema.officials.lastName })
    .from(schema.eventOfficials)
    .innerJoin(schema.officials, eq(schema.officials.id, schema.eventOfficials.officialId))
    .where(eq(schema.eventOfficials.eventId, eventId));
  const times = reminderTimes(event.date);
  const outbox = new EmailOutboxService(executor);
  for (const { user, identityKey } of recipients) {
    const payload = {
      firstName: user.firstName, eventName: event.name, eventStart, venue: event.venue,
      assignedOfficials: officials.map((o: any) => `${o.first} ${o.last}`),
      eventUrl: `/events/${event.id}`, eventId, version: event.notificationVersion, identityKey,
    };
    const key = `event:${event.id}:v${event.notificationVersion}:user:${user.id}:identity:${identityKey}`;
    if (assignment) await outbox.enqueue({ type: "event_created", recipientUserId: user.id,
      recipientEmail: user.email, payload, deduplicationKey: `${key}:assigned`,
      scheduledFor: now, expiresAt: new Date(now.getTime() + 7 * 86_400_000) });
    for (const kind of ["day_of", "day_after"] as const) {
      if (times[kind] < now) continue; // Never backfill missed reminder days.
      await outbox.enqueue({ type: "event_reminder", recipientUserId: user.id,
        recipientEmail: user.email, payload: { ...payload, reminderKind: kind },
        deduplicationKey: `${key}:${kind}`, scheduledFor: times[kind],
        expiresAt: kind === "day_of" ? times.dayEnd : times.end });
    }
  }
}

export async function cancelCoachEventEmails(executor: any, userId: number, now = new Date()) {
  await executor.update(schema.emailOutbox).set({
    status: "cancelled", claimedAt: null, claimedBy: null, claimToken: null,
    updatedAt: now, lastErrorCode: "COACH_IDENTITY_CHANGED",
    lastError: "Coach notification details require reapproval",
  }).where(and(
    eq(schema.emailOutbox.recipientUserId, userId),
    inArray(schema.emailOutbox.type, ["event_created", "event_reminder"]),
    inArray(schema.emailOutbox.status, ["pending", "retry_wait", "processing"]),
  ));
}

export async function reconcileCoachEventEmails(executor: any, userId: number, now = new Date()) {
  await cancelCoachEventEmails(executor, userId, now);
  const today = formatInTimeZone(now, EVENT_TIMEZONE, "yyyy-MM-dd");
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 1); // Yesterday can have today's follow-up.
  const events = await executor.select({ event: schema.events })
    .from(schema.coachNotificationIdentities)
    .innerJoin(schema.eventTeams, eq(schema.eventTeams.teamId, schema.coachNotificationIdentities.teamId))
    .innerJoin(schema.events, eq(schema.events.id, schema.eventTeams.eventId))
    .where(and(eq(schema.coachNotificationIdentities.userId, userId),
      gte(schema.events.date, earliest)));
  for (const { event } of events) {
    const recipients = (await eventCoaches(executor, event.id))
      .filter(({ user }: any) => user.id === userId);
    await queueForRecipients(executor, event, recipients, now, eventDay(event.date) >= today);
  }
}

export async function queueEvaluationReviewerEmails(executor: any,
  review: { id: number; userId: number; eventId: number; isPending: boolean | null },
  event: schema.Event, official: schema.Official, coach: schema.User) {
  const recipients = await executor.select().from(schema.users).where(and(
    eq(schema.users.isVerified, true),
    sql`(${schema.users.role} = 'admin' OR
      (${schema.users.userType} = 'Regional Supervisor' AND
       ${schema.users.region} = ${event.region}))`,
  ));
  const outbox = new EmailOutboxService(executor);
  for (const recipient of recipients) {
    await outbox.enqueue({
      type: "evaluation_submitted", recipientUserId: recipient.id, recipientEmail: recipient.email,
      payload: { firstName: recipient.firstName, eventName: event.name,
        officialName: `${official.firstName} ${official.lastName}`, isPending: !!review.isPending,
        audience: "reviewer", coachName: `${coach.firstName} ${coach.lastName}`,
        reviewUrl: `/events/${event.id}` },
      deduplicationKey: `evaluation-reviewer:${review.id}:${recipient.id}`,
    });
  }
  // Persist cancellation rather than relying solely on dispatch-time checks.
  await executor.update(schema.emailOutbox).set({
    status: "cancelled", claimedAt: null, claimedBy: null, claimToken: null,
    lastErrorCode: "EVALUATION_SUBMITTED", lastError: "Evaluation already submitted",
    updatedAt: new Date(),
  }).where(and(
    eq(schema.emailOutbox.type, "event_reminder"),
    eq(schema.emailOutbox.recipientUserId, coach.id),
    inArray(schema.emailOutbox.status, ["pending", "retry_wait", "processing"]),
    sql`${schema.emailOutbox.payload}->>'eventId' = ${String(event.id)}`,
    sql`${schema.emailOutbox.payload}->>'reminderKind' = 'day_after'`,
  ));
}
