import { and, eq, isNull, or } from "drizzle-orm";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import * as schema from "@shared/schema";

export const EVENT_TIMEZONE = "America/New_York";
export const EVENT_REMINDER_HOUR = "08:00:00";

// The existing event date is a calendar date stored as UTC midnight, not an
// instant to display in the server's local timezone.
export function eventDay(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid event date");
  return date.toISOString().slice(0, 10);
}

export function reminderTimes(date: Date) {
  const day = eventDay(date);
  const tomorrow = new Date(`${day}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    day_of: fromZonedTime(`${day}T${EVENT_REMINDER_HOUR}`, EVENT_TIMEZONE),
    day_after: fromZonedTime(`${eventDay(tomorrow)}T${EVENT_REMINDER_HOUR}`, EVENT_TIMEZONE),
    dayEnd: fromZonedTime(`${day}T23:59:59.999`, EVENT_TIMEZONE),
    end: fromZonedTime(`${eventDay(tomorrow)}T23:59:59.999`, EVENT_TIMEZONE),
  };
}

export function eventStartLabel(date: Date, startTime: string | null) {
  const day = eventDay(date);
  // Never invent a start time for historical events.
  if (!startTime) return `${day} (start time not specified; ${EVENT_TIMEZONE})`;
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(startTime.trim());
  if (!match) throw new Error("Event start time must be HH:mm or h:mm AM/PM");
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > (match[3] ? 12 : 23) || (match[3] && hours < 1)) {
    throw new Error("Invalid event start time");
  }
  if (match[3]) hours = hours % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const instant = fromZonedTime(`${day}T${String(hours).padStart(2, "0")}:${match[2]}:00`, EVENT_TIMEZONE);
  // Reject the nonexistent clock hour at the spring DST transition.
  if (formatInTimeZone(instant, EVENT_TIMEZONE, "HH:mm") !==
      `${String(hours).padStart(2, "0")}:${match[2]}`) throw new Error("Invalid event start time");
  return formatInTimeZone(instant, EVENT_TIMEZONE, "MMM d, yyyy 'at' h:mm a zzz");
}

// Match the same exact school/team relationship used by getEventsForCoach.
// Derive a missing coach region from the assigned trusted team; an explicitly
// conflicting region is never accepted.
export async function eventCoaches(executor: any, eventId: number) {
  return executor.select({ user: schema.users, team: schema.teams,
    identityKey: schema.coachNotificationIdentities.identityKey })
    .from(schema.eventTeams)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventTeams.eventId))
    .innerJoin(schema.teams, eq(schema.teams.id, schema.eventTeams.teamId))
    .innerJoin(schema.coachNotificationIdentities,
      eq(schema.coachNotificationIdentities.teamId, schema.teams.id))
    .innerJoin(schema.users, and(
      eq(schema.users.id, schema.coachNotificationIdentities.userId),
      eq(schema.users.email, schema.coachNotificationIdentities.email),
      eq(schema.users.school, schema.teams.name),
      or(isNull(schema.users.region), eq(schema.users.region, schema.teams.region)),
      eq(schema.teams.region, schema.events.region),
      eq(schema.users.userType, "Coach"),
      eq(schema.users.isVerified, true),
    ))
    .where(eq(schema.eventTeams.eventId, eventId));
}

export async function isEventEmailEligible(executor: any, row: schema.EmailOutbox, now: Date) {
  const payload = row.payload;
  if (!Number.isInteger(payload.eventId) || !Number.isInteger(payload.version) ||
      !row.recipientUserId) return false;
  const [event] = await executor.select().from(schema.events)
    .where(eq(schema.events.id, payload.eventId as number));
  if (!event || event.notificationVersion !== payload.version) return false;
  const recipients = await eventCoaches(executor, event.id);
  if (!recipients.some(({ user, identityKey }: any) =>
    identityKey === payload.identityKey &&
    user.id === row.recipientUserId && user.email.toLowerCase() === row.recipientEmail)) return false;
  const times = reminderTimes(event.date);
  if (row.type === "event_reminder" &&
      now > (payload.reminderKind === "day_of" ? times.dayEnd : times.end)) return false;
  if (payload.reminderKind === "day_after") {
    const [review] = await executor.select({ id: schema.reviews.id }).from(schema.reviews)
      .where(and(eq(schema.reviews.eventId, event.id),
        eq(schema.reviews.userId, row.recipientUserId))).limit(1);
    if (review) return false;
  }
  return true;
}
