import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, or, like, desc, asc, count, sql } from 'drizzle-orm';
import { pool } from './db';
import * as schema from '@shared/schema';
import type {
  Official, InsertOfficial,
  Review, InsertReview,
  Event, InsertEvent,
  EventOfficial, EventTeam,
  User, InsertUser,
  Team, InsertTeam,
  UserSettings, Settings
} from "@shared/schema";
import bcrypt from "bcryptjs";
import { approveCoachNotificationIdentity } from "./email/coach-notification-identity";
import { cancelCoachEventEmails } from "./email/event-notifications";
import { cancelEventEmails, eventFingerprint, queueEventEmails,
  queueEvaluationReviewerEmails } from "./email/event-notifications";
import {
  RatingsService,
  type RatingBreakdown,
  type RatingReview,
} from "./services/ratings";
import { isEventReviewable, isValidRating } from "./services/review-policy";
import { logger } from "./logger";
import { emailOutboxService } from "./email/outbox";

export interface SearchFilters {
  startDate?: Date;
  endDate?: Date;
  eventType?: string;
  venue?: string;
  host?: string;
}

export class ReviewValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

export class UserVerificationConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "UserVerificationConflictError";
  }
}

export interface IStorage {
  // Officials
  getOfficials(page?: number, limit?: number): Promise<{data: Official[], total: number}>;
  getOfficialById(id: number): Promise<Official | undefined>;
  getOfficialBySlug(slug: string): Promise<Official | null>; // Added for slug-based retrieval
  searchOfficials(query: string): Promise<Official[]>;
  createOfficial(official: InsertOfficial & { photoUrl?: string }): Promise<Official>;
  updateOfficialRating(id: number): Promise<void>;
  getOfficialRatingBreakdown(id: number): Promise<RatingBreakdown>;
  updateOfficial(id: number, official: Partial<InsertOfficial>): Promise<Official>;
  deleteOfficial(id: number): Promise<void>;
  refreshAllOfficialRatings(): Promise<void>; // New method to refresh all officials' ratings

  // Events
  getEvents(): Promise<Event[]>;
  getEventById(id: number): Promise<Event | undefined>;
  searchEvents(query: string, filters?: SearchFilters): Promise<Event[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: InsertEvent): Promise<Event>;
  getEventOfficials(eventId: number): Promise<Official[]>;
  deleteEvent(id: number): Promise<void>;

  // Reviews
  getReviewsForOfficial(officialId: number, showPending?: boolean): Promise<Review[]>;
  getApprovedReviewsForOfficial(officialId: number): Promise<Review[]>;
  getReviewsForOfficialForModeration(officialId: number): Promise<Review[]>;
  getReviewById(id: number): Promise<Review | undefined>;
  createReview(review: InsertReview & { userId: number }): Promise<Review>;
  reportReview(id: number): Promise<void>;
  approvePendingReviewsForUser(userId: number): Promise<void>;
  approveUser(userId: number): Promise<User | undefined>;
  verifyUserWithStatusEmail(
    userId: number,
    approved: boolean,
  ): Promise<User | undefined>;

  // User methods
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createUserWithRegistrationEmail(
    user: InsertUser,
    photoUrl?: string | null,
  ): Promise<User>;
  getPendingUsers(): Promise<User[]>;
  getAllCoaches(): Promise<User[]>; // Get all verified coaches for admin
  getCoachesByRegion(region: string): Promise<User[]>; // Get coaches filtered by region for supervisors
  deleteUser(userId: number): Promise<void>;
  getUsersByRole(role: string): Promise<User[]>;
  getUsersByType(userType: string): Promise<User[]>;
  getUsersByTypeAndRegion(userType: string, region: string): Promise<User[]>;

  // Events for Officials and Coaches
  getEventsForOfficial(officialId: number): Promise<Event[]>;
  getEventsForCoach(schoolName: string): Promise<Event[]>; // Get events for a coach based on their school/team
  updateUserProfile(userId: number, updates: Partial<User>, approveEventIdentity?: boolean): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>; // Added for general user updates
  updateUserPassword(userId: number, hashedPassword: string): Promise<void>; // Added for password updates

  // Teams
  getTeams(): Promise<Team[]>;
  getAllTeams(): Promise<Team[]>;
  getTeamById(id: number): Promise<Team | undefined>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team>;
  deleteTeam(id: number): Promise<void>;
  getEventTeams(eventId: number): Promise<Team[]>;

  getSetting(key: string): Promise<string | null>;
  updateSetting(key: string, value: string): Promise<Settings>;

  // User settings
  getUserSetting(userId: number, key: string): Promise<string | null>;
  updateUserSetting(userId: number, key: string, value: string): Promise<UserSettings>;
  getUserSettings(userId: number): Promise<UserSettings[]>;

  // Delete review
  deleteReview(id: number): Promise<void>;
  getAllUsers(): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  private db;

  constructor() {
    this.db = drizzle(pool, { schema });
  }

  private createRatingsService(executor: any = this.db): RatingsService {
    return new RatingsService({
      getApprovedRatingReviews: (officialId) =>
        this.getApprovedRatingReviews(officialId, executor),
      persistOfficialRating: (officialId, values) =>
        this.persistOfficialRating(officialId, values, executor),
    });
  }

  private async getApprovedRatingReviews(
    officialId: number,
    executor: any = this.db,
  ): Promise<RatingReview[]> {
    return executor
      .select({
        mechanics: schema.reviews.mechanics,
        professionalism: schema.reviews.professionalism,
        positioning: schema.reviews.positioning,
        stalling: schema.reviews.stalling,
        consistency: schema.reviews.consistency,
        appearance: schema.reviews.appearance,
      })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.officialId, officialId),
          eq(schema.reviews.isPending, false),
        ),
      );
  }

  private async persistOfficialRating(
    officialId: number,
    values: { averageRating: number; totalReviews: number },
    executor: any = this.db,
  ): Promise<void> {
    await executor
      .update(schema.officials)
      .set(values)
      .where(eq(schema.officials.id, officialId));
  }

  private async activatePendingReviewsForUser(
    userId: number,
    executor: any = this.db,
  ): Promise<number[]> {
    const pendingReviews = await executor
      .select({ officialId: schema.reviews.officialId })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.userId, userId),
          eq(schema.reviews.isPending, true),
        ),
      );

    if (pendingReviews.length === 0) {
      return [];
    }

    await executor
      .update(schema.reviews)
      .set({ isPending: false })
      .where(
        and(
          eq(schema.reviews.userId, userId),
          eq(schema.reviews.isPending, true),
        ),
      );

    const typedPendingReviews = pendingReviews as Array<{ officialId: number }>;
    const officialIds = Array.from(
      new Set(typedPendingReviews.map((review) => review.officialId)),
    );
    const ratingsService = this.createRatingsService(executor);

    for (const officialId of officialIds) {
      await ratingsService.recalculateOfficial(officialId);
    }

    return officialIds;
  }

  /**
   * Creates a URL-friendly slug from first and last name
   * @param firstName The official's first name
   * @param lastName The official's last name
   * @returns A slug like "johnsmith" from "John Smith"
   */
  private createSlug(firstName: string, lastName: string): string {
    return `${firstName}${lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''); // Remove any non-alphanumeric characters
  }

  async getOfficials(page?: number, limit?: number): Promise<{data: Official[], total: number}> {
    try {
      const officials = await this.db.select().from(schema.officials);
      const officialsList = Array.isArray(officials) ? officials : [];

      // Normalize photo URLs
      officialsList.forEach(official => {
        if (official.photoUrl) {
          official.photoUrl = official.photoUrl.replace(/\\/g, '/');
          if (!official.photoUrl.startsWith('/')) {
            official.photoUrl = `/${official.photoUrl}`;
          }
        }
      });

      if (page && limit) {
        const offset = (page - 1) * limit;
        const paginatedOfficials = officialsList.slice(offset, offset + limit);
        return {
          data: paginatedOfficials,
          total: officialsList.length
        };
      }

      return {
        data: officialsList,
        total: officialsList.length
      };
    } catch (error) {
      console.error(
        'Storage.getOfficials: Database error:',
        error instanceof Error ? error.message : error,
      );
      return {
        data: [],
        total: 0
      };
    }
  }

  async getOfficialById(id: number): Promise<Official | undefined> {
    const [official] = await this.db
      .select()
      .from(schema.officials)
      .where(eq(schema.officials.id, id));

    if (official && official.photoUrl) {
      // Normalize photo URL for local paths
      official.photoUrl = official.photoUrl.replace(/\\/g, '/');
      if (!official.photoUrl.startsWith('/')) {
        official.photoUrl = `/${official.photoUrl}`;
      }
    }

    return official;
  }

  async getOfficialBySlug(slug: string): Promise<Official | null> {
    console.log(`Storage.getOfficialBySlug: Fetching official with slug ${slug}`);
    try {
      // Get all officials and find the one whose slug matches
      const allOfficials = await this.db.select().from(schema.officials);

      for (const official of allOfficials) {
        const officialSlug = this.createSlug(official.firstName, official.lastName);
        if (officialSlug === slug) {
          // Normalize photo URL
          if (official.photoUrl) {
            official.photoUrl = official.photoUrl.replace(/\\/g, '/');
            if (!official.photoUrl.startsWith('/')) {
              official.photoUrl = `/${official.photoUrl}`;
            }
          }

          console.log(`Storage.getOfficialBySlug: Found official:`, {
            id: official.id,
            name: `${official.firstName} ${official.lastName}`,
            slug: officialSlug,
            photoUrl: official.photoUrl
          });
          return official;
        }
      }

      console.log(`Storage.getOfficialBySlug: No official found with slug ${slug}`);
      return null;
    } catch (error) {
      console.error(`Storage.getOfficialBySlug: Error fetching official ${slug}:`, error);
      throw new Error(`Failed to fetch official: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async searchOfficials(query: string): Promise<Official[]> {
    const searchTerm = `%${query}%`;
    return await this.db
      .select()
      .from(schema.officials)
      .where(
        or(
          like(schema.officials.firstName, searchTerm),
          like(schema.officials.lastName, searchTerm),
          like(schema.officials.location, searchTerm)
        )
      );
  }

  async createOfficial(official: InsertOfficial & { photoUrl?: string }): Promise<Official> {
    console.log('Creating official in database:', {
      name: `${official.firstName} ${official.lastName}`,
      photoUrl: official.photoUrl || 'No photo'
    });

    const [newOfficial] = await this.db
      .insert(schema.officials)
      .values({
        firstName: official.firstName,
        lastName: official.lastName,
        age: official.age,
        location: official.location,
        association: official.association,
        yearsExperience: official.yearsExperience,
        photoUrl: official.photoUrl || null,
        averageRating: 0,
        totalReviews: 0
      })
      .returning();

    console.log('Official created in database with photoUrl:', newOfficial.photoUrl);

    // Normalize for client response
    if (newOfficial.photoUrl) {
      newOfficial.photoUrl = newOfficial.photoUrl.replace(/\\/g, '/');
      if (!newOfficial.photoUrl.startsWith('/')) {
        newOfficial.photoUrl = `/${newOfficial.photoUrl}`;
      }
    }

    return newOfficial;
  }

  async updateOfficialRating(id: number): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await this.createRatingsService(tx).recalculateOfficial(id);
      });
    } catch (error) {
      console.error(`Error updating rating for official ${id}:`, error);
      throw error;
    }
  }

  async refreshAllOfficialRatings(): Promise<void> {
    const { data: officials } = await this.getOfficials();
    for (const official of officials) {
      await this.updateOfficialRating(official.id);
    }
  }

  async getOfficialRatingBreakdown(id: number): Promise<RatingBreakdown> {
    return this.createRatingsService().getOfficialBreakdown(id);
  }

  async updateOfficial(id: number, officialData: Partial<InsertOfficial>): Promise<Official> {
    const [updated] = await this.db
      .update(schema.officials)
      .set(officialData)
      .where(eq(schema.officials.id, id))
      .returning();

    // Normalize for client response
    if (updated.photoUrl) {
      updated.photoUrl = updated.photoUrl.replace(/\\/g, '/');
      if (!updated.photoUrl.startsWith('/')) {
        updated.photoUrl = `/${updated.photoUrl}`;
      }
    }

    return updated;
  }

  async deleteOfficial(id: number): Promise<void> {
    // First delete related event_officials records
    await this.db
      .delete(schema.eventOfficials)
      .where(eq(schema.eventOfficials.officialId, id));

    // Then delete related reviews
    await this.db
      .delete(schema.reviews)
      .where(eq(schema.reviews.officialId, id));

    // Finally delete the official
    await this.db
      .delete(schema.officials)
      .where(eq(schema.officials.id, id));
  }

  // Get all events, optimized for performance and error handling
  async getEvents(): Promise<Event[]> {
    try {
      const events = await this.db
        .select({
          id: schema.events.id,
          name: schema.events.name,
          date: schema.events.date,
          startTime: schema.events.startTime,
          venue: schema.events.venue,
          description: schema.events.description,
          eventType: schema.events.eventType,
          host: schema.events.host,
          region: schema.events.region,
          notificationVersion: schema.events.notificationVersion,
        }).from(schema.events).orderBy(schema.events.date);

      return events;
    } catch (error) {
      console.error(
        'Storage.getEvents: Database error:',
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  async getEventById(id: number): Promise<Event | undefined> {
    const [event] = await this.db
      .select({
        id: schema.events.id,
        name: schema.events.name,
        date: schema.events.date,
        startTime: schema.events.startTime,
        venue: schema.events.venue,
        description: schema.events.description,
        eventType: schema.events.eventType,
        host: schema.events.host,
        region: schema.events.region,
        notificationVersion: schema.events.notificationVersion,
      })
      .from(schema.events)
      .where(eq(schema.events.id, id));
    return event;
  }

  async searchEvents(query: string, filters?: SearchFilters): Promise<Event[]> {
    const searchTerm = `%${query}%`;
    return await this.db
      .select({
        id: schema.events.id,
        name: schema.events.name,
        date: schema.events.date,
        startTime: schema.events.startTime,
        venue: schema.events.venue,
        description: schema.events.description,
        eventType: schema.events.eventType,
        host: schema.events.host,
        region: schema.events.region,
        notificationVersion: schema.events.notificationVersion,
      })
      .from(schema.events)
      .where(
        or(
          like(schema.events.name, searchTerm),
          like(schema.events.venue, searchTerm),
          like(schema.events.description || '', searchTerm),
          like(schema.events.host, searchTerm)
        )
      );
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    // Start a transaction to ensure both event and official assignments are created
    logger.debug("Starting event creation transaction");

    // Validate required fields
    if (!event.name || !event.date || !event.venue) {
      throw new Error('Event name, date, and venue are required');
    }

    try {
      const result = await this.db.transaction(async (tx) => {
        // First create the event
        const [newEvent] = await tx
          .insert(schema.events)
          .values({
            name: event.name.trim(),
            date: new Date(event.date),
            startTime: event.startTime || null,
            venue: event.venue.trim(),
            description: event.description?.trim() || null,
            eventType: event.eventType?.trim() || null,
            host: event.host?.trim() || null,
            region: event.region?.trim() || null,
          })
          .returning();

        logger.debug("Event row created");

        // Validate officials exist before adding them
        if (event.officials && event.officials.length > 0) {
          logger.debug("Adding event officials", { count: event.officials.length });
          for (const official of event.officials) {
            if (!official.officialId || isNaN(official.officialId)) {
              throw new Error(`Invalid official ID: ${official.officialId}`);
            }

            // Verify official exists
            const officialExists = await tx
              .select({ id: schema.officials.id })
              .from(schema.officials)
              .where(eq(schema.officials.id, official.officialId));

            if (officialExists.length === 0) {
              throw new Error(`Official with ID ${official.officialId} does not exist`);
            }

            await tx
              .insert(schema.eventOfficials)
              .values({
                eventId: newEvent.id,
                officialId: official.officialId,
                role: official.role || null
              });
          }
        }

        // Validate teams exist before adding them
        if (event.teams && event.teams.length > 0) {
          logger.debug("Adding event teams", { count: event.teams.length });
          for (const teamId of event.teams) {
            if (!teamId || isNaN(teamId)) {
              throw new Error(`Invalid team ID: ${teamId}`);
            }

            // Verify team exists
            const teamExists = await tx
              .select({ id: schema.teams.id })
              .from(schema.teams)
              .where(eq(schema.teams.id, teamId));

            if (teamExists.length === 0) {
              throw new Error(`Team with ID ${teamId} does not exist`);
            }

            const insertResult = await tx
              .insert(schema.eventTeams)
              .values({
                eventId: newEvent.id,
                teamId: teamId
              })
              .returning();

          }

          // Verify the teams were actually inserted
          const verifyTeams = await tx
            .select()
            .from(schema.eventTeams)
            .where(eq(schema.eventTeams.eventId, newEvent.id));

          logger.debug("Verified event teams", { count: verifyTeams.length });
        }

        await queueEventEmails(tx, newEvent.id);
        logger.info("Event creation transaction completed");
        return newEvent;
      });

      return result;
    } catch (error) {
      logger.error("Event creation transaction failed");
      throw new Error(error instanceof Error ? error.message : 'Failed to create event');
    }
  }

  async updateEvent(id: number, event: InsertEvent): Promise<Event> {
    logger.debug("Starting event update transaction");

    try {
      const result = await this.db.transaction(async (tx) => {
        const [lockedEvent] = await tx.select({ id: schema.events.id })
          .from(schema.events).where(eq(schema.events.id, id)).for("update");
        if (!lockedEvent) throw new Error("Event not found");
        const previousFingerprint = await eventFingerprint(tx, id);
        // Convert date string to Date object for database storage
        let dateValue: Date;
        if (typeof event.date === 'string') {
          // Parse YYYY-MM-DD string as a UTC Date object to prevent timezone shifts
          const [year, month, day] = event.date.split('-').map(Number);
          dateValue = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
        } else {
          dateValue = event.date;
        }

        // Update the event itself
        logger.debug("Updating event row");

        const [updatedEvent] = await tx
          .update(schema.events)
          .set({
            name: event.name,
            date: dateValue,
            startTime: event.startTime,
            venue: event.venue,
            eventType: event.eventType,
            host: event.host,
            region: event.region,
          })
          .where(eq(schema.events.id, id))
          .returning();

        if (!updatedEvent) {
          logger.warn("Event update target not found");
          throw new Error('Event not found');
        }

        logger.debug("Event row updated");

        // Delete existing official assignments
        logger.debug("Replacing event officials");
        await tx
          .delete(schema.eventOfficials)
          .where(eq(schema.eventOfficials.eventId, id));

        // Create new official assignments
        if (event.officials && event.officials.length > 0) {
          logger.debug("Adding replacement event officials", { count: event.officials.length });
          for (const official of event.officials) {
            await tx
              .insert(schema.eventOfficials)
              .values({
                eventId: updatedEvent.id,
                officialId: official.officialId,
                role: official.role || null
              });
          }
        }

        // Delete existing team assignments
        logger.debug("Replacing event teams");
        await tx
          .delete(schema.eventTeams)
          .where(eq(schema.eventTeams.eventId, id));

        // Create new team assignments
        if (event.teams && event.teams.length > 0) {
          logger.debug("Adding replacement event teams", { count: event.teams.length });
          for (const teamId of event.teams) {
            await tx
              .insert(schema.eventTeams)
              .values({
                eventId: updatedEvent.id,
                teamId: teamId
              });
          }
        }

        await queueEventEmails(tx, id, previousFingerprint);
        logger.info("Event update transaction completed");
        return updatedEvent;
      });

      return result;
    } catch (error) {
      logger.error("Event update transaction failed");
      throw error;
    }
  }

  async getEventOfficials(eventId: number): Promise<Official[]> {
    logger.debug("Fetching event officials");
    const result = await this.db
      .select({
        id: schema.officials.id,
        firstName: schema.officials.firstName,
        lastName: schema.officials.lastName,
        age: schema.officials.age,
        location: schema.officials.location,
        association: schema.officials.association,
        yearsExperience: schema.officials.yearsExperience,
        photoUrl: schema.officials.photoUrl,
        averageRating: schema.officials.averageRating,
        totalReviews: schema.officials.totalReviews,
        userId: schema.officials.userId,
        role: schema.eventOfficials.role
      })
      .from(schema.eventOfficials)
      .innerJoin(schema.officials, eq(schema.eventOfficials.officialId, schema.officials.id))
      .where(eq(schema.eventOfficials.eventId, eventId));

    logger.debug("Fetched event officials", { count: result.length });
    return result;
  }

  async getApprovedReviewsForOfficial(officialId: number): Promise<Review[]> {
    return this.queryReviewsForOfficial(officialId, false);
  }

  async getReviewsForOfficialForModeration(officialId: number): Promise<Review[]> {
    return this.queryReviewsForOfficial(officialId, true);
  }

  async getReviewsForOfficial(officialId: number, showPending: boolean = false): Promise<Review[]> {
    return showPending
      ? this.getReviewsForOfficialForModeration(officialId)
      : this.getApprovedReviewsForOfficial(officialId);
  }

  async getReviewById(id: number): Promise<Review | undefined> {
    const [review] = await this.db
      .select({
        id: schema.reviews.id,
        officialId: schema.reviews.officialId,
        userId: schema.reviews.userId,
        eventId: schema.reviews.eventId,
        mechanics: schema.reviews.mechanics,
        professionalism: schema.reviews.professionalism,
        positioning: schema.reviews.positioning,
        stalling: schema.reviews.stalling,
        consistency: schema.reviews.consistency,
        appearance: schema.reviews.appearance,
        comment: schema.reviews.comment,
        videoUrl: schema.reviews.videoUrl,
        date: schema.reviews.date,
        isReported: schema.reviews.isReported,
        isAnonymous: schema.reviews.isAnonymous,
        isPending: schema.reviews.isPending,
        user: {
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          userType: schema.users.userType,
          photoUrl: schema.users.photoUrl,
        },
        event: {
          name: schema.events.name,
          date: schema.events.date,
        },
      })
      .from(schema.reviews)
      .innerJoin(schema.users, eq(schema.reviews.userId, schema.users.id))
      .innerJoin(schema.events, eq(schema.reviews.eventId, schema.events.id))
      .where(eq(schema.reviews.id, id));
    return review;
  }

  private async queryReviewsForOfficial(
    officialId: number,
    includePending: boolean,
  ): Promise<Review[]> {
    try {
      if (!officialId || officialId <= 0) {
        // Invalid officialId, return empty array
        console.warn(`getReviewsForOfficial: Invalid officialId provided: ${officialId}`);
        return [];
      }

      const reviews = await this.db
        .select({
          id: schema.reviews.id,
          officialId: schema.reviews.officialId,
          userId: schema.reviews.userId,
          eventId: schema.reviews.eventId,
          mechanics: schema.reviews.mechanics,
          professionalism: schema.reviews.professionalism,
          positioning: schema.reviews.positioning,
          stalling: schema.reviews.stalling,
          consistency: schema.reviews.consistency,
          appearance: schema.reviews.appearance,
          comment: schema.reviews.comment,
          videoUrl: schema.reviews.videoUrl,
          date: schema.reviews.date,
          isReported: schema.reviews.isReported,
          isAnonymous: schema.reviews.isAnonymous,
          isPending: schema.reviews.isPending, // Include isPending flag
          user: {
            firstName: schema.users.firstName,
            lastName: schema.users.lastName,
            userType: schema.users.userType,
            photoUrl: schema.users.photoUrl
          },
          event: {
            name: schema.events.name,
            date: schema.events.date
          }
        })
        .from(schema.reviews)
        .innerJoin(
          schema.users,
          eq(schema.reviews.userId, schema.users.id)
        )
        .innerJoin(
          schema.events,
          eq(schema.reviews.eventId, schema.events.id)
        )
        .where(
          and(
            eq(schema.reviews.officialId, officialId),
            includePending ? undefined : eq(schema.reviews.isPending, false)
          )
        )
        .orderBy(desc(schema.reviews.date));
      return reviews;
    } catch (error) {
      console.error(`Error fetching reviews for official ${officialId}:`, error);
      // Return empty array on error to prevent cascading failures
      return [];
    }
  }

  async createReview(review: InsertReview & { userId: number; videoUrl?: string | null }): Promise<Review> {
    // Validate input data
    if (!review.userId || !review.officialId || !review.eventId) {
      throw new ReviewValidationError("User ID, Official ID, and Event ID are required");
    }

    // Validate rating values are within acceptable range (1-5)
    const ratings = [review.mechanics, review.professionalism, review.positioning, review.stalling, review.consistency, review.appearance];
    if (ratings.some((rating) => !isValidRating(rating))) {
      throw new ReviewValidationError("All ratings must be whole numbers between 1 and 5");
    }

    // Check if user has already reviewed this official for this event
    const existingReview = await this.db
      .select()
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.userId, review.userId),
          eq(schema.reviews.officialId, review.officialId),
          eq(schema.reviews.eventId, review.eventId)
        )
      );

    if (existingReview.length > 0) {
      throw new ReviewValidationError("You have already reviewed this official for this event");
    }

    // Verify user exists
    const user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, review.userId));

    if (user.length === 0) {
      throw new ReviewValidationError("User not found");
    }

    // Determine if the review should be pending based on user verification
    const isPending = !user[0].isVerified;

    // Verify official exists
    const official = await this.db
      .select()
      .from(schema.officials)
      .where(eq(schema.officials.id, review.officialId));

    if (official.length === 0) {
      throw new ReviewValidationError("Official not found");
    }

    // Verify event exists
    const event = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, review.eventId));

    if (event.length === 0) {
      throw new ReviewValidationError("Event not found");
    }

    if (!isEventReviewable(new Date(event[0].date))) {
      throw new ReviewValidationError("Future events cannot be reviewed");
    }

    // Check if official was assigned to this event
    const officialEvent = await this.db
      .select()
      .from(schema.eventOfficials)
      .where(
        and(
          eq(schema.eventOfficials.officialId, review.officialId),
          eq(schema.eventOfficials.eventId, review.eventId)
        )
      );

    if (officialEvent.length === 0) {
      throw new ReviewValidationError("This official was not assigned to this event");
    }

    const newReview = await this.db.transaction(async (tx) => {
      const [createdReview] = await tx
        .insert(schema.reviews)
        .values({
          ...review,
          comment: review.comment || "",
          videoUrl: review.videoUrl || null,
          date: new Date(),
          isReported: false,
          isPending,
        })
        .onConflictDoNothing({ target: [
          schema.reviews.userId, schema.reviews.officialId, schema.reviews.eventId,
        ] })
        .returning();

      if (!createdReview) {
        throw new ReviewValidationError("You have already reviewed this official for this event");
      }
      if (!isPending) {
        await this.createRatingsService(tx).recalculateOfficial(review.officialId);
      }

      await emailOutboxService.withExecutor(tx).enqueue({
        type: "evaluation_submitted",
        recipientUserId: user[0].id,
        recipientEmail: user[0].email,
        payload: {
          firstName: user[0].firstName,
          eventName: event[0].name,
          officialName: `${official[0].firstName} ${official[0].lastName}`,
          isPending,
        },
        deduplicationKey: `evaluation-submitted:${createdReview.id}`,
      });

      await queueEvaluationReviewerEmails(tx, createdReview, event[0], official[0], user[0]);
      return createdReview;
    });

    // Return the review with user and event information
    const [reviewWithDetails] = await this.db
      .select({
        id: schema.reviews.id,
        officialId: schema.reviews.officialId,
        userId: schema.reviews.userId,
        eventId: schema.reviews.eventId,
        mechanics: schema.reviews.mechanics,
        professionalism: schema.reviews.professionalism,
        positioning: schema.reviews.positioning,
        stalling: schema.reviews.stalling,
        consistency: schema.reviews.consistency,
        appearance: schema.reviews.appearance,
        comment: schema.reviews.comment,
        videoUrl: schema.reviews.videoUrl,
        date: schema.reviews.date,
        isReported: schema.reviews.isReported,
        isAnonymous: schema.reviews.isAnonymous,
        isPending: schema.reviews.isPending,
        user: {
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          userType: schema.users.userType,
          photoUrl: schema.users.photoUrl
        },
        event: {
          name: schema.events.name,
          date: schema.events.date
        }
      })
      .from(schema.reviews)
      .innerJoin(
        schema.users,
        eq(schema.reviews.userId, schema.users.id)
      )
      .innerJoin(
        schema.events,
        eq(schema.reviews.eventId, schema.events.id)
      )
      .where(eq(schema.reviews.id, newReview.id));

    return reviewWithDetails;
  }

  async reportReview(id: number): Promise<void> {
    await this.db
      .update(schema.reviews)
      .set({ isReported: true })
      .where(eq(schema.reviews.id, id));
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.trim().toLowerCase()));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    // Normalize photo URL if present
    if (user && user.photoUrl) {
      user.photoUrl = user.photoUrl.replace(/\\/g, '/');
      if (!user.photoUrl.startsWith('/')) {
        user.photoUrl = `/${user.photoUrl}`;
      }
    }

    return user;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const [user] = await this.db
      .insert(schema.users)
      .values({
        ...userData,
        password: hashedPassword,
        role: 'user',
        isVerified: false,
        verificationToken: null,
        verificationExpires: null,
        createdAt: new Date()
      })
      .returning();
    return user;
  }

  async createUserWithRegistrationEmail(
    userData: InsertUser,
    photoUrl?: string | null,
  ): Promise<User> {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          ...userData,
          password: hashedPassword,
          photoUrl: photoUrl ?? null,
          role: "user",
          isVerified: false,
          verificationToken: null,
          verificationExpires: null,
          createdAt: new Date(),
        })
        .returning();

      await emailOutboxService.withExecutor(tx).enqueue({
        type: "registration_received",
        recipientUserId: user.id,
        recipientEmail: user.email,
        payload: {
          firstName: user.firstName,
        },
        deduplicationKey: `registration-received:${user.id}`,
      });

      return user;
    });
  }

  async getPendingUsers(): Promise<User[]> {
    return await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.isVerified, false),
          eq(schema.users.role, 'user')
        )
      );
  }

  async getAllCoaches(): Promise<User[]>{
    const coaches = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.isVerified, true),
          eq(schema.users.userType, 'Coach')
        )
      );

    // Normalize photo URLs for all coaches
    coaches.forEach(coach => {
      if (coach.photoUrl) {
        coach.photoUrl = coach.photoUrl.replace(/\\/g, '/');
        if (!coach.photoUrl.startsWith('/')) {
          coach.photoUrl = `/${coach.photoUrl}`;
        }
      }
    });

    return coaches;
  }

  async getCoachesByRegion(region: string): Promise<User[]>{
    return await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.isVerified, true),
          eq(schema.users.userType, 'Coach'),
          eq(schema.users.region, region)
        )
      );
  }

  async deleteUser(userId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const affectedReviews = await tx
        .select({ officialId: schema.reviews.officialId })
        .from(schema.reviews)
        .where(eq(schema.reviews.userId, userId));
      const officialIds = Array.from(
        new Set(affectedReviews.map((review) => review.officialId)),
      );

      await tx
        .delete(schema.reviews)
        .where(eq(schema.reviews.userId, userId));

      await tx
        .delete(schema.users)
        .where(eq(schema.users.id, userId));

      const ratingsService = this.createRatingsService(tx);
      for (const officialId of officialIds) {
        await ratingsService.recalculateOfficial(officialId);
      }
    });
  }

  async getUsersByRole(role: string): Promise<User[]> {
    try {
      const result = await this.db.select()
        .from(schema.users)
        .where(eq(schema.users.role, role));

      return result;
    } catch (error) {
      console.error('Error fetching users by role:', error);
      throw new Error('Failed to fetch users by role');
    }
  }

  async getUsersByType(userType: string): Promise<User[]> {
    try {
      logger.debug("Fetching users by type");

      const result = await this.db.select()
        .from(schema.users)
        .where(eq(schema.users.userType, userType));

      logger.debug("Fetched users by type", { count: result.length });

      return result;
    } catch (error) {
      logger.error("Failed to fetch users by type");
      throw new Error('Failed to fetch users by type');
    }
  }

  async getUsersByTypeAndRegion(userType: string, region: string): Promise<User[]>{
    return await this.db
      .select()
      .from(schema.users)
      .where(and(
        eq(schema.users.userType, userType),
        eq(schema.users.region, region)
      ));
  }

  async deleteReview(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [review] = await tx
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.id, id));

      if (!review) {
        return;
      }

      await tx
        .delete(schema.reviews)
        .where(eq(schema.reviews.id, id));

      await this.createRatingsService(tx).recalculateOfficial(review.officialId);
    });
  }

  async approvePendingReviewsForUser(userId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.activatePendingReviewsForUser(userId, tx);
    });
  }

  async approveUser(userId: number): Promise<User | undefined> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));

      if (!user) {
        return undefined;
      }

      const [approvedUser] = await tx
        .update(schema.users)
        .set({
          isVerified: true,
          verificationToken: null,
          verificationExpires: null,
        })
        .where(eq(schema.users.id, userId))
        .returning();

      await this.activatePendingReviewsForUser(userId, tx);
      await approveCoachNotificationIdentity(tx, approvedUser);
      return approvedUser;
    });
  }

  async verifyUserWithStatusEmail(
    userId: number,
    approved: boolean,
  ): Promise<User | undefined> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .for("update");

      if (!user) {
        return undefined;
      }

      const outbox = emailOutboxService.withExecutor(tx);
      if (approved) {
        const [approvedUser] = await tx
          .update(schema.users)
          .set({
            isVerified: true,
            verificationToken: null,
            verificationExpires: null,
          })
          .where(eq(schema.users.id, userId))
          .returning();

        await this.activatePendingReviewsForUser(userId, tx);
        await approveCoachNotificationIdentity(tx, approvedUser);
        await outbox.enqueue({
          type: "account_approved",
          recipientUserId: user.id,
          recipientEmail: user.email,
          payload: {
            firstName: user.firstName,
          },
          deduplicationKey: `account-approved:${user.id}`,
        });
        return approvedUser;
      }

      if (user.isVerified) {
        throw new UserVerificationConflictError(
          "An approved account cannot be rejected",
        );
      }

      const registrationCancellation =
        await outbox.cancelObsoleteRegistrationMessages(user.id);
      if (registrationCancellation.processing > 0) {
        throw new UserVerificationConflictError(
          "Account rejection is unavailable while a registration email is processing",
        );
      }

      await outbox.enqueue({
        type: "account_rejected",
        recipientUserId: user.id,
        recipientEmail: user.email,
        payload: {
          firstName: user.firstName,
        },
        deduplicationKey: `account-rejected:${user.id}`,
      });

      const affectedReviews = await tx
        .select({ officialId: schema.reviews.officialId })
        .from(schema.reviews)
        .where(eq(schema.reviews.userId, userId));
      const officialIds = Array.from(
        new Set(affectedReviews.map((review) => review.officialId)),
      );

      await tx
        .delete(schema.reviews)
        .where(eq(schema.reviews.userId, userId));

      await tx
        .delete(schema.users)
        .where(eq(schema.users.id, userId));

      const ratingsService = this.createRatingsService(tx);
      for (const officialId of officialIds) {
        await ratingsService.recalculateOfficial(officialId);
      }

      return user;
    });
  }

  async getAllUsers(): Promise<any[]> {
    return await this.db.select().from(schema.users);
  }

  async getTeams(): Promise<Team[]> {
    try {
      const teams = await this.db.select().from(schema.teams);
      const teamsList = Array.isArray(teams) ? teams : [];
      return teamsList;
    } catch (error) {
      console.error(
        'Storage.getTeams: Database error:',
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  async getTeamById(id: number): Promise<Team | undefined> {
    const [team] = await this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, id));
    return team;
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [created] = await this.db
      .insert(schema.teams)
      .values({
        name: team.name.trim(),
        region: team.region?.trim() || null,
      })
      .returning();
    return created;
  }

  async updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team> {
    const [updated] = await this.db
      .update(schema.teams)
      .set({
        ...(team.name !== undefined ? { name: team.name.trim() } : {}),
        ...(team.region !== undefined
          ? { region: team.region?.trim() || null }
          : {}),
      })
      .where(eq(schema.teams.id, id))
      .returning();

    if (!updated) {
      throw new Error("Team not found");
    }
    return updated;
  }

  async deleteTeam(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.eventTeams)
        .where(eq(schema.eventTeams.teamId, id));
      await tx.delete(schema.teams).where(eq(schema.teams.id, id));
    });
  }

  async getAllTeams(): Promise<Team[]> {
    return this.getTeams();
  }

  async getSetting(key: string): Promise<string | null> {
    const [setting] = await this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key));
    return setting?.value ?? null;
  }

  async updateSetting(key: string, value: string): Promise<Settings> {
    const [existing] = await this.db
      .select({ id: schema.settings.id })
      .from(schema.settings)
      .where(eq(schema.settings.key, key));

    if (existing) {
      const [updated] = await this.db
        .update(schema.settings)
        .set({ value, updatedAt: new Date() })
        .where(eq(schema.settings.key, key))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(schema.settings)
      .values({ key, value, updatedAt: new Date() })
      .returning();
    return created;
  }

  async getUserSetting(userId: number, key: string): Promise<string | null> {
    const [setting] = await this.db
      .select()
      .from(schema.userSettings)
      .where(
        and(
          eq(schema.userSettings.userId, userId),
          eq(schema.userSettings.key, key),
        ),
      );
    return setting?.value ?? null;
  }

  async updateUserSetting(userId: number, key: string, value: string): Promise<UserSettings> {
    const [existing] = await this.db
      .select({ id: schema.userSettings.id })
      .from(schema.userSettings)
      .where(
        and(
          eq(schema.userSettings.userId, userId),
          eq(schema.userSettings.key, key),
        ),
      );

    if (existing) {
      const [updated] = await this.db
        .update(schema.userSettings)
        .set({ value, updatedAt: new Date() })
        .where(eq(schema.userSettings.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(schema.userSettings)
      .values({ userId, key, value, updatedAt: new Date() })
      .returning();
    return created;
  }

  async getUserSettings(userId: number): Promise<UserSettings[]> {
    return this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .orderBy(asc(schema.userSettings.key));
  }

  async getEventTeams(eventId: number): Promise<Team[]> {
    logger.debug("Fetching event teams");

    const eventTeamsList = await this.db
      .select()
      .from(schema.eventTeams)
      .where(eq(schema.eventTeams.eventId, eventId));

    logger.debug("Fetched event team assignments", { count: eventTeamsList.length });

    const teams: Team[] = [];
    for (const et of eventTeamsList) {
      const team = await this.db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, et.teamId));

      if (team.length > 0) {
        teams.push(team[0]);
      } else {
        logger.warn("Event team references a missing team");
      }
    }

    logger.debug("Fetched event teams", { count: teams.length });
    return teams;
  }

  async updateUser(id: number, data: Partial<User>): Promise<User> {
    const [updated] = await this.db
      .update(schema.users)
      .set(data)
      .where(eq(schema.users.id, id))
      .returning();

    // Normalize photo URL if present
    if (updated && updated.photoUrl) {
      updated.photoUrl = updated.photoUrl.replace(/\\/g, '/');
      if (!updated.photoUrl.startsWith('/')) {
        updated.photoUrl = `/${updated.photoUrl}`;
      }
    }

    return updated;
  }

  async updateUserProfile(userId: number, updates: Partial<User>, approveEventIdentity = false): Promise<User> {
    updates = {
      ...updates,
      ...(updates.email !== undefined ? { email: updates.email.trim().toLowerCase() } : {}),
      ...(updates.school != null ? { school: updates.school.trim() } : {}),
    };
    const updated = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(schema.users)
        .where(eq(schema.users.id, userId)).for("update");
      if (!current) throw new Error("User not found");
      const [changed] = await tx.update(schema.users).set(updates)
        .where(eq(schema.users.id, userId)).returning();
      if (approveEventIdentity) {
        await approveCoachNotificationIdentity(tx, changed);
      } else if (current.email !== changed.email || current.school !== changed.school ||
                 current.region !== changed.region || !changed.isVerified) {
        await tx.delete(schema.coachNotificationIdentities)
          .where(eq(schema.coachNotificationIdentities.userId, userId));
        await cancelCoachEventEmails(tx, userId);
      }
      return changed;
    });

    // Normalize photo URL if present
    if (updated && updated.photoUrl) {
      updated.photoUrl = updated.photoUrl.replace(/\\/g, '/');
      if (!updated.photoUrl.startsWith('/')) {
        updated.photoUrl = `/${updated.photoUrl}`;
      }
    }

    return updated;
  }

  async updateUserPassword(userId: number, hashedPassword: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({
        password: hashedPassword,
        sessionVersion: sql`${schema.users.sessionVersion} + 1`,
      })
      .where(eq(schema.users.id, userId));
  }

  async deleteEvent(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(eq(schema.events.id, id))
        .for("update");

      await cancelEventEmails(tx, id);
      const affectedReviews = await tx
        .select({ officialId: schema.reviews.officialId })
        .from(schema.reviews)
        .where(eq(schema.reviews.eventId, id));
      const officialIds = Array.from(
        new Set(affectedReviews.map((review) => review.officialId)),
      );

      await tx
        .delete(schema.eventTeams)
        .where(eq(schema.eventTeams.eventId, id));

      await tx
        .delete(schema.eventOfficials)
        .where(eq(schema.eventOfficials.eventId, id));

      await tx
        .delete(schema.events)
        .where(eq(schema.events.id, id));

      const ratingsService = this.createRatingsService(tx);
      for (const officialId of officialIds) {
        await ratingsService.recalculateOfficial(officialId);
      }
    });
  }

  async getEventsForOfficial(officialId: number): Promise<Event[]> {
    logger.debug("Fetching official events");
    const result = await this.db
      .select({
        id: schema.events.id,
        name: schema.events.name,
        date: schema.events.date,
        startTime: schema.events.startTime,
        venue: schema.events.venue,
        description: schema.events.description,
        eventType: schema.events.eventType,
        host: schema.events.host,
        region: schema.events.region,
        notificationVersion: schema.events.notificationVersion,
      })
      .from(schema.eventOfficials)
      .innerJoin(schema.events, eq(schema.eventOfficials.eventId, schema.events.id))
      .where(eq(schema.eventOfficials.officialId, officialId))
      .orderBy(desc(schema.events.date));

    logger.debug("Fetched official events", { count: result.length });
    return result;
  }

  async getEventsForCoach(schoolName: string): Promise<Event[]> {
    logger.debug("Fetching coach events");

    // First find the team ID for this school
    const [team] = await this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.name, schoolName));

    if (!team) {
      logger.debug("No matching coach team found");
      return [];
    }

    // Then find all events associated with this team
    const result = await this.db
      .select({
        id: schema.events.id,
        name: schema.events.name,
        date: schema.events.date,
        startTime: schema.events.startTime,
        venue: schema.events.venue,
        description: schema.events.description,
        eventType: schema.events.eventType,
        host: schema.events.host,
        region: schema.events.region,
        notificationVersion: schema.events.notificationVersion,
      })
      .from(schema.eventTeams)
      .innerJoin(schema.events, eq(schema.eventTeams.eventId, schema.events.id))
      .where(eq(schema.eventTeams.teamId, team.id))
      .orderBy(desc(schema.events.date));

    logger.debug("Fetched coach events", { count: result.length });
    return result;
  }
}

export const storage = new DatabaseStorage();