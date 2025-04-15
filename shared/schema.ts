import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  region: text("region"), // Optional, only for supervisors
  yearsExperience: integer("years_experience"), // Optional, only for supervisors
  photoUrl: text("photo_url"), // Profile photo URL
  isVerified: boolean("is_verified").default(false),
  verificationToken: text("verification_token"),
  verificationExpires: timestamp("verification_expires"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const officials = pgTable("officials", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  age: integer("age").notNull(),
  location: text("location").notNull(),
  association: text("association").notNull(),
  yearsExperience: integer("years_experience").notNull(),
  photoUrl: text("photo_url"),
  averageRating: integer("average_rating").default(0),
  totalReviews: integer("total_reviews").default(0),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  date: timestamp("date").notNull(),
  startTime: text("start_time"), // Added startTime field
  venue: text("venue").notNull(),
  description: text("description"),
  eventType: text("event_type").notNull(),
  host: text("host").notNull(),
});

export const eventOfficials = pgTable("event_officials", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  officialId: integer("official_id").notNull(),
  role: text("role"), // e.g., "Head Referee", "Assistant", etc.
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const eventTeams = pgTable("event_teams", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  teamId: integer("team_id").notNull(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  officialId: integer("official_id").notNull(),
  userId: integer("user_id").notNull(),
  eventId: integer("event_id").notNull(), // Added to link review to specific event
  mechanics: integer("mechanics").notNull(),
  professionalism: integer("professionalism").notNull(),
  positioning: integer("positioning").notNull(),
  stalling: integer("stalling").notNull(),
  consistency: integer("consistency").notNull(),
  appearance: integer("appearance").notNull(),
  comment: text("comment").notNull(),
  date: timestamp("date").defaultNow(),
  isReported: boolean("is_reported").default(false),
  isAnonymous: boolean("is_anonymous").default(false), // Added to support anonymous reviews
});

export const registerUserSchema = createInsertSchema(users)
  .omit({
    id: true,
    role: true,
    isVerified: true,
    verificationToken: true,
    verificationExpires: true,
    createdAt: true,
  })
  .extend({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    password: z.string().min(8).max(100),
    confirmPassword: z.string(),
    userType: z.enum(["Coach", "Regional Supervisor"]),
    school: z.string().optional().nullable(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine(
    (data) => {
      if (data.userType === "Coach" && !data.school) {
        return false;
      }
      return true;
    },
    {
      message: "School is required for coaches",
      path: ["school"],
    },
  );

export const loginUserSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

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
  .omit({ id: true })
  .extend({
    date: z.string().or(z.date()),
    startTime: z.string().optional(), // Added startTime validation
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
    isAnonymous: z.boolean().default(false),
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

export const insertSettingsSchema = createInsertSchema(settings)
  .omit({ id: true, updatedAt: true });

export const insertUserSettingsSchema = createInsertSchema(userSettings)
  .omit({ id: true, updatedAt: true });

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;