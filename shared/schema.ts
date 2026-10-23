import {
  pgTable,
  text,
  serial,
  integer,
  real,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: text("role").notNull().default("user"),
  userType: text("user_type").notNull(), // "Coach" or "Regional Supervisor"
  school: text("school"), // Optional, only for coaches
  yearsCoaching: integer("years_coaching"), // Optional, only for coaches
  region: text("region"), // Authorization region for supervisors and managed coaches
  yearsExperience: integer("years_experience"), // Optional, only for supervisors
  photoUrl: text("photo_url"), // Profile photo URL
  isVerified: boolean("is_verified").default(false),
  verificationToken: text("verification_token"),
  verificationExpires: timestamp("verification_expires"),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userTypeRegionIdx: index("users_user_type_region_idx").on(
    table.userType,
    table.region,
  ),
}));

export const officials = pgTable("officials", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  age: integer("age").notNull(),
  location: text("location").notNull(),
  association: text("association").notNull(),
  yearsExperience: integer("years_experience").notNull(),
  photoUrl: text("photo_url"),
  averageRating: real("average_rating").default(0),
  totalReviews: integer("total_reviews").default(0),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  associationIdx: index("officials_association_idx").on(table.association),
}));

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  date: timestamp("date").notNull(),
  startTime: text("start_time"), // Added startTime field
  venue: text("venue").notNull(),
  description: text("description"),
  eventType: text("event_type"),
  host: text("host"),
  region: text("region"),
  notificationVersion: integer("notification_version").notNull().default(0),
}, (table) => ({
  regionDateIdx: index("events_region_date_idx").on(table.region, table.date),
}));

export const eventOfficials = pgTable("event_officials", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  officialId: integer("official_id").notNull().references(() => officials.id, { onDelete: "cascade" }),
  role: text("role"), // e.g., "Head Referee", "Assistant", etc.
}, (table) => ({
  uniqueEventOfficial: uniqueIndex("event_officials_event_official_unique").on(
    table.eventId,
    table.officialId,
  ),
}));

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  region: text("region"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  regionIdx: index("teams_region_idx").on(table.region),
}));

export const eventTeams = pgTable("event_teams", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
}, (table) => ({
  uniqueEventTeam: uniqueIndex("event_teams_event_team_unique").on(
    table.eventId,
    table.teamId,
  ),
}));

// Captured only by account approval or an authorized managed-coach save.
// Self-service profile edits cannot establish or restore this trust.
export const coachNotificationIdentities = pgTable("coach_notification_identities", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  identityKey: text("identity_key").notNull().default(sql`gen_random_uuid()::text`),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

// Operator-only journals; no public routes or startup jobs use these tables.
export const emailValidationFixtures = pgTable("email_validation_fixtures", {
  runId: text("run_id").primaryKey(),
  state: text("state").notNull(),
  records: jsonb("records").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const emailValidationAuthorizations = pgTable("email_validation_authorizations", {
  authorizationId: text("authorization_id").primaryKey(),
  fixtureRunId: text("fixture_run_id").notNull().references(() => emailValidationFixtures.runId),
  manifestHash: text("manifest_hash").notNull().unique(),
  state: text("state").notNull(),
  attemptsUsed: integer("attempts_used").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull(),
  attemptedRowIds: jsonb("attempted_row_ids").notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  officialId: integer("official_id").notNull().references(() => officials.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  mechanics: integer("mechanics").notNull(),
  professionalism: integer("professionalism").notNull(),
  positioning: integer("positioning").notNull(),
  stalling: integer("stalling").notNull(),
  consistency: integer("consistency").notNull(),
  appearance: integer("appearance").notNull(),
  comment: text("comment").notNull(),
  videoUrl: text("video_url"), // Added for video clip support
  date: timestamp("date").defaultNow(),
  isReported: boolean("is_reported").default(false),
  isAnonymous: boolean("is_anonymous").default(false), // Added to support anonymous reviews
  isPending: boolean("is_pending").default(false), // Review is pending until coach is verified
}, (table) => ({
  officialPendingIdx: index("reviews_official_pending_idx").on(
    table.officialId,
    table.isPending,
  ),
  userIdx: index("reviews_user_idx").on(table.userId),
  uniqueUserOfficialEvent: uniqueIndex(
    "reviews_user_official_event_unique",
  ).on(table.userId, table.officialId, table.eventId),
}));

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({
  userStateIdx: index("password_reset_tokens_user_state_idx").on(
    table.userId,
    table.usedAt,
    table.revokedAt,
    table.expiresAt,
  ),
  expiryIdx: index("password_reset_tokens_expiry_idx").on(table.expiresAt),
}));

// Shared, atomic rate limits across Autoscale instances. No raw email/IP data.
export const passwordResetRateLimits = pgTable("password_reset_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  expiryIdx: index("password_reset_rate_limits_expiry_idx").on(table.expiresAt),
}));

export const registerUserSchema = createInsertSchema(users)
  .omit({
    id: true,
    role: true,
    isVerified: true,
    verificationToken: true,
    verificationExpires: true,
    createdAt: true,
    photoUrl: true,
  })
  .extend({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    password: z.string().min(8, "Password must be at least 8 characters").max(100),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    userType: z.enum(["Coach", "Regional Supervisor"]),
    school: z.string().optional().nullable(),
    yearsCoaching: z.number().optional().nullable(),
    region: z.string().optional().nullable(),
    yearsExperience: z.number().optional().nullable(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine(
    (data) => {
      if (data.userType === "Coach" && (!data.school || data.school.trim() === "")) {
        return false;
      }
      return true;
    },
    {
      message: "School is required for coaches",
      path: ["school"],
    },
  )
  .refine(
    (data) => {
      if (data.userType === "Regional Supervisor" && (!data.region || data.region.trim() === "")) {
        return false;
      }
      return true;
    },
    {
      message: "Region is required for Regional Supervisors",
      path: ["region"],
    },
  );

export const loginUserSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(320),
});

export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export const verifyUserStatusSchema = z.object({
  approved: z.boolean(),
}).strict();

// Use conditional type check for File to support both browser and Node environments
const fileSchema = z.custom<File>((value) => {
  return typeof window !== "undefined" ? value instanceof File : true;
}, "Must be a valid file");

export const insertOfficialSchema = createInsertSchema(officials)
  .omit({
    id: true,
    averageRating: true,
    totalReviews: true,
    photoUrl: true,
  })
  .extend({
    photo: fileSchema.optional(),
  });

export const insertTeamSchema = createInsertSchema(teams)
  .omit({ id: true, createdAt: true });

export const insertEventSchema = createInsertSchema(events)
  .omit({ id: true, notificationVersion: true })
  .extend({
    date: z.string().or(z.date()),
    startTime: z.string().optional(), // Added startTime validation
    eventType: z.string().min(1, "Event type is required"),
    officials: z.array(
      z.object({
        officialId: z.number(),
        role: z.string().optional(),
      }),
    ),
    teams: z.array(z.number()).optional(),
  });

export const insertReviewSchema = createInsertSchema(reviews)
  .omit({
    id: true,
    date: true,
    isReported: true,
    userId: true,
    videoUrl: true,
  })
  .extend({
    mechanics: z.number().min(1).max(5),
    professionalism: z.number().min(1).max(5),
    positioning: z.number().min(1).max(5),
    stalling: z.number().min(1).max(5),
    consistency: z.number().min(1).max(5),
    appearance: z.number().min(1).max(5),
    comment: z.string().optional(),
    eventId: z.number(),
    video: z.custom<File>((value) => {
      return typeof window !== "undefined" ? value instanceof File : true;
    }, "Must be a valid video file").optional(),
  });

export const reviewWithUserSchema = createInsertSchema(reviews).extend({
  user: z.object({
    firstName: z.string(),
    lastName: z.string(),
    userType: z.string(),
    photoUrl: z.string().nullable()
  }),
  event: z.object({
    name: z.string(),
    date: z.string().or(z.date())
  })
});

// Update the Review type to include user and event information
export type Review = typeof reviews.$inferSelect & {
  user: {
    firstName: string;
    lastName: string;
    userType: string;
    photoUrl: string | null;
  };
  event: {
    name: string;
    date: Date;
  };
};

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof registerUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type Official = typeof officials.$inferSelect;
export type InsertOfficial = z.infer<typeof insertOfficialSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type EventOfficial = typeof eventOfficials.$inferSelect;
export type EventTeam = typeof eventTeams.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;

// Add settings table for site-wide settings
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Add user settings table for user-specific preferences
export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailOutboxTypes = [
  "registration_received",
  "account_approved",
  "account_rejected",
  "evaluation_submitted",
  "password_reset",
  "event_created",
  "event_reminder",
  "controlled_delivery_test",
] as const;

export const emailOutboxStatuses = [
  "pending",
  "processing",
  "retry_wait",
  "sent",
  "failed",
  "cancelled",
] as const;

export const emailOutbox = pgTable("email_outbox", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  recipientUserId: integer("recipient_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  recipientEmail: text("recipient_email").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  encryptedPayload: text("encrypted_payload"),
  deduplicationKey: text("deduplication_key").notNull().unique(),
  status: text("status").notNull().default("pending"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastErrorCode: text("last_error_code"),
  lastError: text("last_error"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimedBy: text("claimed_by"),
  claimToken: text("claim_token"),
  providerMessageId: text("provider_message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dueIdx: index("email_outbox_due_idx").on(
    table.status,
    table.scheduledFor,
    table.nextAttemptAt,
  ),
  claimIdx: index("email_outbox_claim_idx").on(table.status, table.claimedAt),
  recipientIdx: index("email_outbox_recipient_idx").on(
    table.recipientUserId,
    table.createdAt,
  ),
  typeCheck: check(
    "email_outbox_type_check",
    sql`${table.type} IN ('registration_received', 'account_approved', 'account_rejected', 'evaluation_submitted', 'password_reset', 'event_created', 'event_reminder', 'controlled_delivery_test')`,
  ),
  statusCheck: check(
    "email_outbox_status_check",
    sql`${table.status} IN ('pending', 'processing', 'retry_wait', 'sent', 'failed', 'cancelled')`,
  ),
  attemptsCheck: check(
    "email_outbox_attempts_check",
    sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0`,
  ),
  passwordResetPayloadCheck: check(
    "email_outbox_password_reset_payload_check",
    sql`${table.type} <> 'password_reset' OR (${table.encryptedPayload} IS NOT NULL AND NOT jsonb_exists(${table.payload}, 'resetUrl'))`,
  ),
}));

export const insertSettingsSchema = createInsertSchema(settings)
  .omit({ id: true, updatedAt: true });

export const insertUserSettingsSchema = createInsertSchema(userSettings)
  .omit({ id: true, updatedAt: true });

export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({ id: true, createdAt: true });

// Shared schemas for admin-created users
export const createSupervisorSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  region: z.string().min(1, "Association is required"),
  yearsExperience: z.number().min(0, "Years of experience must be 0 or greater"),
  photo: z.any().optional(),
});

export const createCoachSchema = z.object({
  firstName: z.string().min(1, "First name is required").trim(),
  lastName: z.string().min(1, "Last name is required").trim(),
  email: z.string().email("Invalid email address").trim(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  school: z.string().min(1, "School is required").trim(),
  yearsCoaching: z.coerce.number().int().nonnegative().default(0),
  photo: z.any().optional(),
});

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type EmailOutbox = typeof emailOutbox.$inferSelect;
export type InsertEmailOutbox = typeof emailOutbox.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type CreateSupervisor = z.infer<typeof createSupervisorSchema>;
export type CreateCoach = z.infer<typeof createCoachSchema>;
export type ForgotPassword = z.infer<typeof forgotPasswordSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;