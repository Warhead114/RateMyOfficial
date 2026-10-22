import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import * as s from "@shared/schema";
import { RatingsService } from "../../services/ratings";
import { EmailOutboxService } from "../outbox";
import { demand, digest, operatorGate, type FixtureRecords } from "./contracts";
import { assertOwnedOutbox, approvedRecipients, loadFixture, officialBaseline } from "./fixtures";

export async function inspectFixtures(executor: any, runId: string) {
  const { records: r } = await loadFixture(executor, runId, true);
  const reviews = await executor.select({ id: s.reviews.id }).from(s.reviews).where(or(
    eq(s.reviews.userId, r.coachId), eq(s.reviews.officialId, r.officialId),
    inArray(s.reviews.eventId, r.eventIds)));
  const tokens = await executor.select({ id: s.passwordResetTokens.id }).from(s.passwordResetTokens)
    .where(inArray(s.passwordResetTokens.userId, [r.coachId, r.supervisorId]));
  // Metadata only: no payloads, plaintext tokens, encrypted blobs or addresses.
  const outbox = await executor.select({ id: s.emailOutbox.id, type: s.emailOutbox.type,
    status: s.emailOutbox.status }).from(s.emailOutbox).where(or(
    inArray(s.emailOutbox.recipientUserId, [r.coachId, r.supervisorId]),
    ...r.eventIds.map((id) => sql`${s.emailOutbox.payload}->>'eventId' = ${String(id)}`),
    ...Array.from(new Set([...reviews.map((row: any) => row.id), ...r.reviewIds])).map((id) =>
      sql`(${s.emailOutbox.deduplicationKey} = ${`evaluation-submitted:${id}`} OR
        ${s.emailOutbox.deduplicationKey} LIKE ${`evaluation-reviewer:${id}:%`})`)));
  return { reviews, tokens, outbox };
}
async function validateCleanup(executor: any, runId: string) {
  const { records: r } = await loadFixture(executor, runId, true);
  const active = await executor.select().from(s.emailValidationAuthorizations).where(and(
    eq(s.emailValidationAuthorizations.fixtureRunId, runId),
    eq(s.emailValidationAuthorizations.state, "running"),
    gt(s.emailValidationAuthorizations.expiresAt, new Date())));
  demand(!active.length, "Validation invocation is active; cleanup refused");
  const protectedNow = await officialBaseline(executor, r.officialId);
  demand(Object.keys(r.protectedOfficials).every((id) => id in protectedNow),
    "A protected official is missing: stop for operator review");
  const [team] = await executor.select().from(s.teams).where(eq(s.teams.id, r.teamId));
  demand(team?.name === `Email validation ${runId}` && team.region === `EMAIL-VALIDATION:${runId}`,
    "Fixture team ownership changed");
  const users = await executor.select().from(s.users).where(inArray(s.users.id, [r.coachId, r.supervisorId]));
  demand(users.length === 2 && users.every((u: any) => u.role === "user" &&
    u.region === team.region && approvedRecipients(r).includes(u.email) &&
    (u.id === r.coachId ? u.userType === "Coach" && u.school === team.name :
      u.userType === "Regional Supervisor")), "Fixture account ownership changed");
  const [official] = await executor.select().from(s.officials).where(eq(s.officials.id, r.officialId));
  demand(official?.firstName === "Email validation" && official.lastName === runId &&
    official.association === team.region && official.userId === null, "Fixture official ownership changed");
  const events = await executor.select().from(s.events).where(inArray(s.events.id, r.eventIds));
  demand(events.every((e: any) => e.region === team.region &&
    e.name.startsWith(`Email validation ${runId} `)), "Fixture event ownership changed");
  const unexpectedTeams = await executor.select().from(s.eventTeams)
    .where(or(eq(s.eventTeams.teamId, r.teamId), inArray(s.eventTeams.eventId, r.eventIds)));
  demand(unexpectedTeams.every((row: any) => row.teamId === r.teamId && r.eventIds.includes(row.eventId)),
    "Unrelated event/team relationship; cleanup refused");
  const unexpectedOfficials = await executor.select().from(s.eventOfficials)
    .where(or(eq(s.eventOfficials.officialId, r.officialId), inArray(s.eventOfficials.eventId, r.eventIds)));
  demand(unexpectedOfficials.every((row: any) => row.officialId === r.officialId && r.eventIds.includes(row.eventId)),
    "Unrelated official/event relationship; cleanup refused");
  const schoolUsers = await executor.select({ id: s.users.id }).from(s.users).where(eq(s.users.school, team.name));
  demand(schoolUsers.every((u: any) => u.id === r.coachId), "Unrelated account uses fixture team");
  const related = await inspectFixtures(executor, runId);
  demand(related.reviews.every((row: any) => r.reviewIds.includes(row.id)) &&
    related.tokens.every((row: any) => r.tokenIds.includes(row.id)) &&
    related.outbox.every((row: any) => r.outboxIds.includes(row.id)),
    "Uncaptured related records: inspect and approve exact IDs before cleanup");
  for (const id of r.reviewIds) {
    const [review] = await executor.select().from(s.reviews).where(eq(s.reviews.id, id));
    demand(!review || (review.userId === r.coachId && review.officialId === r.officialId &&
      r.eventIds.includes(review.eventId)), "Unrelated review cannot be deleted");
  }
  for (const id of r.tokenIds) {
    const [token] = await executor.select().from(s.passwordResetTokens).where(eq(s.passwordResetTokens.id, id));
    demand(!token || token.userId === r.coachId, "Unrelated token cannot be deleted");
  }
  for (const id of r.outboxIds) {
    const [row] = await executor.select().from(s.emailOutbox).where(eq(s.emailOutbox.id, id));
    demand(row && row.status !== "processing", "Missing row or in-flight claim: cleanup refused");
    await assertOwnedOutbox(executor, r, row);
  }
  return r;
}
export async function planCleanup(executor: any, runId: string) {
  const records = await validateCleanup(executor, runId);
  return { kind: "cleanup" as const, runId, recordsHash: digest(records),
    protectedOfficials: await officialBaseline(executor, records.officialId),
    userIds: [records.coachId, records.supervisorId], teamId: records.teamId,
    officialId: records.officialId, eventIds: records.eventIds,
    reviewIds: records.reviewIds, tokenIds: records.tokenIds, outboxIds: records.outboxIds };
}
export async function cleanupFixtures(executor: any, plan: Awaited<ReturnType<typeof planCleanup>>,
  acknowledgement: string, env = process.env) {
  operatorGate("cleanup", plan, acknowledgement, env);
  return executor.transaction(async (tx: any) => {
    await tx.select().from(s.emailValidationFixtures).where(eq(s.emailValidationFixtures.runId, plan.runId)).for("update");
    const r = await validateCleanup(tx, plan.runId);
    demand(digest(await planCleanup(tx, plan.runId)) === digest(plan), "Cleanup manifest changed");
    // Lock only owned roots. No protected business official/account is modified.
    await tx.select().from(s.users).where(inArray(s.users.id, plan.userIds)).for("update");
    await tx.select().from(s.officials).where(eq(s.officials.id, r.officialId)).for("update");
    await tx.select().from(s.events).where(inArray(s.events.id, r.eventIds)).for("update");
    await tx.select().from(s.teams).where(eq(s.teams.id, r.teamId)).for("update");
    const claimed = await tx.select().from(s.emailOutbox)
      .where(inArray(s.emailOutbox.id, r.outboxIds)).for("update");
    demand(claimed.every((row: any) => row.status !== "processing"), "Claim became active; cleanup refused");
    await validateCleanup(tx, plan.runId); // Recheck after FK-root locks close insertion races.
    const outbox = new EmailOutboxService(tx);
    for (const id of r.outboxIds) {
      if (await outbox.cancelUnsentMessage(id)) {
        await tx.update(s.emailOutbox).set({
          lastErrorCode: "VALIDATION_FIXTURE_CLEANUP", lastError: "Disposable validation completed",
        }).where(eq(s.emailOutbox.id, id));
      }
    }
    if (r.reviewIds.length) await tx.delete(s.reviews).where(inArray(s.reviews.id, r.reviewIds));
    const ratings = new RatingsService({
      getApprovedRatingReviews: async (id) => tx.select().from(s.reviews)
        .where(and(eq(s.reviews.officialId, id), eq(s.reviews.isPending, false))),
      persistOfficialRating: async (id, values) => {
        demand(id === r.officialId, "Cannot update a protected official");
        await tx.update(s.officials).set(values).where(eq(s.officials.id, id));
      },
    });
    const rating = await ratings.recalculateOfficial(r.officialId);
    demand(rating.approvedReviewCount === 0, "Unrelated reviews remain");
    if (r.tokenIds.length) await tx.delete(s.passwordResetTokens).where(inArray(s.passwordResetTokens.id, r.tokenIds));
    await tx.delete(s.eventOfficials).where(inArray(s.eventOfficials.eventId, r.eventIds));
    await tx.delete(s.eventTeams).where(inArray(s.eventTeams.eventId, r.eventIds));
    await tx.delete(s.events).where(inArray(s.events.id, r.eventIds));
    await tx.delete(s.officials).where(eq(s.officials.id, r.officialId));
    await tx.delete(s.users).where(inArray(s.users.id, [r.coachId, r.supervisorId]));
    await tx.delete(s.teams).where(eq(s.teams.id, r.teamId));
    demand(digest(await officialBaseline(tx)) === digest(plan.protectedOfficials), "Protected official baseline changed during cleanup");
    await tx.update(s.emailValidationFixtures).set({ state: "cleaned" })
      .where(eq(s.emailValidationFixtures.runId, plan.runId));
    return { cleaned: true, protectedOfficialsUnchanged: Object.keys(plan.protectedOfficials).length,
      outboxHistoryPreserved: r.outboxIds.length };
  });
}
