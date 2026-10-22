import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeEmailAddress } from "../policy";
import type { EmailOutbox } from "@shared/schema";

export function demand(ok: unknown, message = "Validation authorization refused"): asserts ok {
  if (!ok) throw new Error(message);
}
function canonical(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function exactEmail(value: string) {
  demand(!value.includes("*") && !value.includes("?"), "Wildcard recipients prohibited");
  return normalizeEmailAddress(value);
}
const email = z.string().max(320).refine((v) => {
  try { return exactEmail(v) === v; } catch { return false; }
});
export const id = z.number().int().positive();
export const ids = z.array(id).max(100).refine((v) => new Set(v).size === v.length);
export const fixtureInput = z.object({
  runId: z.string().uuid(),
  coachEmail: email, alternateCoachEmail: email, supervisorEmail: email,
  adminUserId: id, adminEmail: email,
  evaluationDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reminderDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedProtectedOfficials: z.number().int().min(0).max(10000).default(18),
}).strict().refine((v) => new Set([
  v.coachEmail, v.alternateCoachEmail, v.supervisorEmail, v.adminEmail,
]).size === 4, "Use distinct, explicitly approved addresses");
export type FixtureInput = z.infer<typeof fixtureInput>;
export interface FixtureRecords {
  input: FixtureInput;
  teamId: number; coachId: number; supervisorId: number; officialId: number;
  eventIds: number[]; reviewIds: number[]; tokenIds: number[]; outboxIds: number[];
  protectedOfficials: Record<string, string>;
}
export const validationTypes = ["evaluation_submitted", "password_reset", "event_created", "event_reminder"] as const;
export const sendManifest = z.object({
  kind: z.literal("send"),
  authorizationId: z.string().uuid(), fixtureRunId: z.string().uuid(),
  approvedBy: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  maxSends: z.number().int().min(1).max(10),
  permittedTypes: z.array(z.enum(validationTypes)).min(1).max(4),
  recipients: z.array(email).min(1).max(4),
  rows: z.array(z.object({
    id, type: z.enum(validationTypes), recipientEmail: email,
    rowHash: z.string().regex(/^[a-f0-9]{64}$/),
    messageHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1).max(10),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.rows.map((r) => r.id)).size !== v.rows.length ||
      new Set(v.recipients).size !== v.recipients.length ||
      new Set(v.permittedTypes).size !== v.permittedTypes.length ||
      v.maxSends !== v.rows.length ||
      v.rows.some((r) => !v.recipients.includes(r.recipientEmail) || !v.permittedTypes.includes(r.type))) {
    ctx.addIssue({ code: "custom", message: "Exact unique rows, types, recipients and send limit required" });
  }
});
export type SendManifest = z.infer<typeof sendManifest>;
export function freshWindow(created: string, expires: string, now: Date) {
  const start = Date.parse(created), end = Date.parse(expires);
  demand(start <= now.getTime() && now.getTime() < end &&
    end - start > 0 && end - start <= 15 * 60_000, "Manifest expired or invalid");
}
export function rowHash(row: EmailOutbox) {
  return digest({ id: row.id, type: row.type, recipientUserId: row.recipientUserId,
    recipientEmail: row.recipientEmail, payload: row.payload,
    encryptedPayload: row.encryptedPayload, deduplicationKey: row.deduplicationKey,
    scheduledFor: row.scheduledFor, expiresAt: row.expiresAt, maxAttempts: row.maxAttempts });
}
export function operatorGate(kind: "fixtures" | "send" | "cleanup" | "capture" | "recover",
  plan: unknown, acknowledgement: string, env: NodeJS.ProcessEnv = process.env) {
  demand(env.EMAIL_VALIDATION_ENABLED === "1" && env.EMAIL_DELIVERY_MODE === "controlled" &&
    env.EMAIL_WORKER_ENABLED !== "1", "Validation requires explicit enablement, controlled mode and disabled broad worker");
  demand(env.SKIP_DATABASE_INITIALIZATION === "1", "Startup DDL must be disabled");
  demand(acknowledgement === `${kind}:${digest(plan)}`, "Exact operation/hash authorization required");
}
