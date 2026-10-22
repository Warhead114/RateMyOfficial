import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import * as schema from "@shared/schema";
import { cancelCoachEventEmails, reconcileCoachEventEmails } from "./event-notifications";

export async function approveCoachNotificationIdentity(executor: any, user: schema.User) {
  // Called within the trusted account/managed-profile transaction.
  if (user.userType !== "Coach" || !user.isVerified || !user.school) {
    await executor.delete(schema.coachNotificationIdentities)
      .where(eq(schema.coachNotificationIdentities.userId, user.id));
    await cancelCoachEventEmails(executor, user.id);
    return;
  }
  const [team] = await executor.select().from(schema.teams)
    .where(and(eq(schema.teams.name, user.school),
      user.region ? eq(schema.teams.region, user.region) : undefined))
    .limit(1).for("no key update");
  const [existing] = await executor.select().from(schema.coachNotificationIdentities)
    .where(eq(schema.coachNotificationIdentities.userId, user.id));
  if (team?.region && existing?.teamId === team.id && existing.email === user.email) return;
  await executor.delete(schema.coachNotificationIdentities)
    .where(eq(schema.coachNotificationIdentities.userId, user.id));
  if (!team?.region) {
    await cancelCoachEventEmails(executor, user.id);
    return; // No guessed team/region or client-provided destination.
  }
  await executor.insert(schema.coachNotificationIdentities).values({
    userId: user.id, teamId: team.id, email: user.email.trim().toLowerCase(),
  });
  await reconcileCoachEventEmails(executor, user.id);
}

export async function withCoachNotificationStatus(executor: any, users: schema.User[]) {
  if (!users.length) return [];
  const approved = await executor.select({ id: schema.users.id })
    .from(schema.coachNotificationIdentities)
    .innerJoin(schema.users, eq(schema.users.id, schema.coachNotificationIdentities.userId))
    .innerJoin(schema.teams, eq(schema.teams.id, schema.coachNotificationIdentities.teamId))
    .where(and(
      inArray(schema.users.id, users.map((u) => u.id)),
      eq(schema.users.isVerified, true), eq(schema.users.userType, "Coach"),
      isNotNull(schema.teams.region),
      eq(schema.users.school, schema.teams.name),
      eq(schema.users.email, schema.coachNotificationIdentities.email),
      or(isNull(schema.users.region), eq(schema.users.region, schema.teams.region)),
    ));
  const ids = new Set(approved.map((row: any) => row.id));
  return users.map((user) => ({ ...user, eventEmailsApproved: ids.has(user.id) }));
}
