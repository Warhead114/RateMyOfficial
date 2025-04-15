import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq, and, or, like, desc, asc, sql } from 'drizzle-orm';
import { pool } from './db';
import * as schema from '@shared/schema';
import type { 
  Official, InsertOfficial, 
  Review, InsertReview, 
  Event, InsertEvent, 
  EventOfficial, EventTeam, 
  User, InsertUser, 
  Team, InsertTeam,
  Settings, UserSettings
} from "@shared/schema";
import bcrypt from "bcryptjs";

export interface SearchFilters {
  startDate?: Date;
  endDate?: Date;
  eventType?: string;
  venue?: string;
  host?: string;
}

interface CategoryAverages {
  mechanics: number;
  professionalism: number;
  positioning: number;
  stalling: number;
  consistency: number;
  appearance: number;
  overall: number;
}

export interface IStorage {
  // Officials
  getOfficials(page?: number, limit?: number): Promise<{data: Official[], total: number}>;
  getOfficialById(id: number): Promise<Official | undefined>;
  searchOfficials(query: string): Promise<Official[]>;
  createOfficial(official: InsertOfficial & { photoUrl?: string }): Promise<Official>;
  updateOfficialRating(id: number): Promise<void>;
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
  getReviewsForOfficial(officialId: number): Promise<Review[]>;
  createReview(review: InsertReview & { userId: number }): Promise<Review>;
  reportReview(id: number): Promise<void>;

  // User methods
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  verifyUser(token: string): Promise<boolean>;
  updateVerificationToken(userId: number, token: string | null, expires: Date | null): Promise<void>;
  getPendingUsers(): Promise<User[]>;
  getAllCoaches(): Promise<User[]>; // Get all verified coaches for admin
  getCoachesByRegion(region: string): Promise<User[]>; // Get coaches filtered by region for supervisors
  deleteUser(userId: number): Promise<void>;

  // Events for Officials and Coaches
  getEventsForOfficial(officialId: number): Promise<Event[]>;
  getEventsForCoach(schoolName: string): Promise<Event[]>; // Get events for a coach based on their school/team
  updateUserProfile(userId: number, updates: Partial<User>): Promise<User>;
  
  // Teams
  getTeams(): Promise<Team[]>;
  getTeamById(id: number): Promise<Team | undefined>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team>;
  deleteTeam(id: number): Promise<void>;
  getEventTeams(eventId: number): Promise<Team[]>;
  
  // Settings
  getSetting(key: string): Promise<string | null>;
  updateSetting(key: string, value: string): Promise<Settings>;
  getAllSettings(): Promise<Settings[]>;
  
  // User settings
  getUserSetting(userId: number, key: string): Promise<string | null>;
  updateUserSetting(userId: number, key: string, value: string): Promise<UserSettings>;
  getUserSettings(userId: number): Promise<UserSettings[]>;
  
  // Delete review
  deleteReview(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private db;

  constructor() {
    this.db = drizzle({ client: pool, schema });
  }

  async getOfficials(page: number = 1, limit: number = 20): Promise<{data: Official[], total: number}> {
    const offset = (page - 1) * limit;
    const data = await this.db
      .select()
      .from(schema.officials)
      .limit(limit)
      .offset(offset);
    
    const [{ count }] = await this.db
      .select({ count: sql`count(*)` })
      .from(schema.officials);
      
    return { data, total: Number(count) };
  }

  async getOfficialById(id: number): Promise<Official | undefined> {
    const [official] = await this.db
      .select()
      .from(schema.officials)
      .where(eq(schema.officials.id, id));
    return official;
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
    const [newOfficial] = await this.db
      .insert(schema.officials)
      .values({
        firstName: official.firstName,
        lastName: official.lastName,
        age: official.age,
        location: official.location,
        association: official.association,
        yearsExperience: official.yearsExperience,
        photoUrl: official.photoUrl ? `/${official.photoUrl}` : null,
        averageRating: 0,
        totalReviews: 0
      })
      .returning();
    return newOfficial;
  }

  private async calculateCategoryAverages(officialId: number): Promise<CategoryAverages> {
    const reviews = await this.getReviewsForOfficial(officialId);

    if (reviews.length === 0) {
      return {
        mechanics: 0,
        professionalism: 0,
        positioning: 0,
        stalling: 0,
        consistency: 0,
        appearance: 0,
        overall: 0
      };
    }

    const sums = reviews.reduce((acc, review) => ({
      mechanics: acc.mechanics + review.mechanics,
      professionalism: acc.professionalism + review.professionalism,
      positioning: acc.positioning + review.positioning,
      stalling: acc.stalling + review.stalling,
      consistency: acc.consistency + review.consistency,
      appearance: acc.appearance + review.appearance
    }), {
      mechanics: 0,
      professionalism: 0,
      positioning: 0,
      stalling: 0,
      consistency: 0,
      appearance: 0
    });

    const count = reviews.length;
    const averages = {
      mechanics: Math.round(sums.mechanics / count),
      professionalism: Math.round(sums.professionalism / count),
      positioning: Math.round(sums.positioning / count),
      stalling: Math.round(sums.stalling / count),
      consistency: Math.round(sums.consistency / count),
      appearance: Math.round(sums.appearance / count)
    };

    const overall = Math.round(
      (averages.mechanics +
        averages.professionalism +
        averages.positioning +
        averages.stalling +
        averages.consistency +
        averages.appearance) / 6
    );

    return { ...averages, overall };
  }

  async updateOfficialRating(id: number): Promise<void> {
    const averages = await this.calculateCategoryAverages(id);
    const reviews = await this.getReviewsForOfficial(id);

    await this.db
      .update(schema.officials)
      .set({
        averageRating: averages.overall,
        totalReviews: reviews.length
      })
      .where(eq(schema.officials.id, id));
  }

  async updateOfficial(id: number, officialData: Partial<InsertOfficial>): Promise<Official> {
    const [updated] = await this.db
      .update(schema.officials)
      .set(officialData)
      .where(eq(schema.officials.id, id))
      .returning();
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

  async getEvents(): Promise<Event[]> {
    return await this.db.select({
      id: schema.events.id,
      name: schema.events.name,
      date: schema.events.date,
      startTime: schema.events.startTime,
      venue: schema.events.venue,
      description: schema.events.description,
      eventType: schema.events.eventType,
      host: schema.events.host,
    }).from(schema.events);
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
    console.log('Starting createEvent transaction with data:', {
      name: event.name,
      date: event.date,
      officials: event.officials?.length || 0,
      teams: event.teams?.length || 0
    });
    
    try {
      const result = await this.db.transaction(async (tx) => {
        // First create the event
        const [newEvent] = await tx
          .insert(schema.events)
          .values({
            name: event.name,
            date: new Date(event.date),
            startTime: event.startTime,
            venue: event.venue,
            description: event.description,
            eventType: event.eventType,
            host: event.host
          })
          .returning();

        console.log('Created event:', newEvent);

        // Then create event-official relationships
        if (event.officials && event.officials.length > 0) {
          console.log('Adding officials to event. Count:', event.officials.length);
          for (const official of event.officials) {
            await tx
              .insert(schema.eventOfficials)
              .values({
                eventId: newEvent.id,
                officialId: official.officialId,
                role: official.role || null
              });
            console.log('Added official ID:', official.officialId, 'to event ID:', newEvent.id);
          }
        }

        // Create event-team relationships
        if (event.teams && event.teams.length > 0) {
          console.log('Adding teams to event. Count:', event.teams.length, 'Teams:', event.teams);
          for (const teamId of event.teams) {
            await tx
              .insert(schema.eventTeams)
              .values({
                eventId: newEvent.id,
                teamId: teamId
              });
            console.log('Added team ID:', teamId, 'to event ID:', newEvent.id);
          }
        }

        console.log('Event creation transaction completed successfully for event ID:', newEvent.id);
        return newEvent;
      });
      
      return result;
    } catch (error) {
      console.error('Error in createEvent transaction:', error);
      throw error;
    }
  }

  async updateEvent(id: number, event: InsertEvent): Promise<Event> {
    console.log('Starting updateEvent transaction for event ID:', id, 'with data:', {
      name: event.name,
      date: event.date,
      officials: event.officials?.length || 0,
      teams: event.teams?.length || 0
    });
    
    try {
      const result = await this.db.transaction(async (tx) => {
        // Update the event details
        console.log('Updating event details for ID:', id);
        const [updatedEvent] = await tx
          .update(schema.events)
          .set({
            name: event.name,
            date: new Date(event.date),
            startTime: event.startTime,
            venue: event.venue,
            description: event.description,
            eventType: event.eventType,
            host: event.host
          })
          .where(eq(schema.events.id, id))
          .returning();

        if (!updatedEvent) {
          console.error('Event not found:', id);
          throw new Error('Event not found');
        }
        
        console.log('Event details updated successfully:', updatedEvent);

        // Delete existing official assignments
        console.log('Deleting existing officials for event ID:', id);
        await tx
          .delete(schema.eventOfficials)
          .where(eq(schema.eventOfficials.eventId, id));

        // Create new official assignments
        if (event.officials && event.officials.length > 0) {
          console.log('Adding new officials to event. Count:', event.officials.length);
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
        console.log('Deleting existing teams for event ID:', id);
        await tx
          .delete(schema.eventTeams)
          .where(eq(schema.eventTeams.eventId, id));

        // Create new team assignments
        if (event.teams && event.teams.length > 0) {
          console.log('Adding new teams to event. Count:', event.teams.length, 'Teams:', event.teams);
          for (const teamId of event.teams) {
            await tx
              .insert(schema.eventTeams)
              .values({
                eventId: updatedEvent.id,
                teamId: teamId
              });
            console.log('Added team ID:', teamId, 'to event ID:', updatedEvent.id);
          }
        }

        console.log('Event update transaction completed successfully for event ID:', updatedEvent.id);
        return updatedEvent;
      });
      
      return result;
    } catch (error) {
      console.error('Error in updateEvent transaction:', error);
      throw error;
    }
  }

  async getEventOfficials(eventId: number): Promise<Official[]> {
    return await this.db
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
        totalReviews: schema.officials.totalReviews
      })
      .from(schema.eventOfficials)
      .innerJoin(
        schema.officials,
        eq(schema.eventOfficials.officialId, schema.officials.id)
      )
      .where(eq(schema.eventOfficials.eventId, eventId));
  }

  async getReviewsForOfficial(officialId: number): Promise<Review[]> {
    return await this.db
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
        date: schema.reviews.date,
        isReported: schema.reviews.isReported,
        isAnonymous: schema.reviews.isAnonymous,
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
      .where(eq(schema.reviews.officialId, officialId))
      .orderBy(desc(schema.reviews.date));
  }

  async createReview(review: InsertReview & { userId: number }): Promise<Review> {
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
      throw new Error("You have already reviewed this official for this event");
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
      throw new Error("This official was not assigned to this event");
    }

    const [newReview] = await this.db
      .insert(schema.reviews)
      .values({
        ...review,
        comment: review.comment || "",
        date: new Date(),
        isReported: false
      })
      .returning();

    // Update official's ratings
    await this.updateOfficialRating(review.officialId);

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
        date: schema.reviews.date,
        isReported: schema.reviews.isReported,
        isAnonymous: schema.reviews.isAnonymous,
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
      .where(eq(schema.users.email, email.toLowerCase()));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
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

  async verifyUser(token: string): Promise<boolean> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.verificationToken, token),
          sql`${schema.users.verificationExpires} > NOW()`
        )
      );

    if (!user) {
      return false;
    }

    await this.db
      .update(schema.users)
      .set({
        isVerified: true,
        verificationToken: null,
        verificationExpires: null
      })
      .where(eq(schema.users.id, user.id));

    return true;
  }

  async updateVerificationToken(userId: number, token: string | null, expires: Date | null): Promise<void> {
    await this.db
      .update(schema.users)
      .set({
        verificationToken: token,
        verificationExpires: expires
      })
      .where(eq(schema.users.id, userId));
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

  async getAllCoaches(): Promise<User[]> {
    return await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.isVerified, true),
          eq(schema.users.userType, 'Coach')
        )
      );
  }

  async getCoachesByRegion(region: string): Promise<User[]> {
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
    // First delete related reviews
    await this.db
      .delete(schema.reviews)
      .where(eq(schema.reviews.userId, userId));

    // Then delete the user
    await this.db
      .delete(schema.users)
      .where(eq(schema.users.id, userId));
  }

  async getEventsForOfficial(officialId: number): Promise<Event[]> {
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
      })
      .from(schema.eventOfficials)
      .innerJoin(
        schema.events,
        eq(schema.eventOfficials.eventId, schema.events.id)
      )
      .where(eq(schema.eventOfficials.officialId, officialId))
      .orderBy(desc(schema.events.date));
  }

  async deleteEvent(id: number): Promise<void> {
    // First delete related event_officials records
    await this.db
      .delete(schema.eventOfficials)
      .where(eq(schema.eventOfficials.eventId, id));

    // Delete any event teams records
    await this.db
      .delete(schema.eventTeams)
      .where(eq(schema.eventTeams.eventId, id));

    // Delete related reviews
    await this.db
      .delete(schema.reviews)
      .where(eq(schema.reviews.eventId, id));

    // Finally delete the event
    await this.db
      .delete(schema.events)
      .where(eq(schema.events.id, id));
  }

  async updateUserProfile(userId: number, updates: Partial<User>): Promise<User> {
    const [updatedUser] = await this.db
      .update(schema.users)
      .set(updates)
      .where(eq(schema.users.id, userId))
      .returning();
    
    return updatedUser;
  }

  async refreshAllOfficialRatings(): Promise<void> {
    try {
      const { data: officials } = await this.getOfficials();
      for (const official of officials) {
        await this.updateOfficialRating(official.id);
      }
      console.log('Completed refresh of all official ratings');
    } catch (error) {
      console.error('Error refreshing all official ratings:', error);
      throw error;
    }
  }
  
  async getEventsForCoach(schoolName: string): Promise<Event[]> {
    try {
      // First find the team associated with the school
      const teams = await this.db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.name, schoolName));
      
      if (teams.length === 0) {
        console.log(`No team found with name "${schoolName}"`);
        return [];
      }
      
      const teamId = teams[0].id;
      console.log(`Found team ID ${teamId} for school "${schoolName}"`);
      
      // Then get all events that include this team
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
        })
        .from(schema.eventTeams)
        .innerJoin(
          schema.events,
          eq(schema.eventTeams.eventId, schema.events.id)
        )
        .where(eq(schema.eventTeams.teamId, teamId))
        .orderBy(desc(schema.events.date));
    } catch (error) {
      console.error(`Error getting events for coach with school "${schoolName}":`, error);
      throw error;
    }
  }

  // Team methods implementation
  async getTeams(): Promise<Team[]> {
    return await this.db.select().from(schema.teams);
  }

  async getTeamById(id: number): Promise<Team | undefined> {
    const [team] = await this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, id));
    return team;
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    try {
      // Check if team name already exists
      const existingTeam = await this.db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.name, team.name));
      
      if (existingTeam.length > 0) {
        // Return the existing team if it already exists
        return existingTeam[0];
      }
      
      // Create a new team
      const [newTeam] = await this.db
        .insert(schema.teams)
        .values({
          name: team.name,
          createdAt: new Date(),
        })
        .returning();
      
      return newTeam;
    } catch (error) {
      console.error("Error creating team:", error);
      throw error;
    }
  }

  async updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team> {
    try {
      const [updatedTeam] = await this.db
        .update(schema.teams)
        .set(team)
        .where(eq(schema.teams.id, id))
        .returning();
      
      if (!updatedTeam) {
        throw new Error("Team not found");
      }
      
      return updatedTeam;
    } catch (error) {
      console.error("Error updating team:", error);
      throw error;
    }
  }

  async deleteTeam(id: number): Promise<void> {
    try {
      // Delete event team associations first
      await this.db
        .delete(schema.eventTeams)
        .where(eq(schema.eventTeams.teamId, id));

      // Then delete the team
      await this.db
        .delete(schema.teams)
        .where(eq(schema.teams.id, id));
    } catch (error) {
      console.error("Error deleting team:", error);
      throw error;
    }
  }

  async getEventTeams(eventId: number): Promise<Team[]> {
    return await this.db
      .select({
        id: schema.teams.id,
        name: schema.teams.name,
        createdAt: schema.teams.createdAt
      })
      .from(schema.eventTeams)
      .innerJoin(
        schema.teams,
        eq(schema.eventTeams.teamId, schema.teams.id)
      )
      .where(eq(schema.eventTeams.eventId, eventId));
  }

  // Settings methods
  async getSetting(key: string): Promise<string | null> {
    const [setting] = await this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key));
    
    return setting ? setting.value : null;
  }

  async updateSetting(key: string, value: string): Promise<Settings> {
    // Check if setting already exists
    const existingSetting = await this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key));
    
    let setting;
    
    if (existingSetting.length > 0) {
      // Update existing setting
      [setting] = await this.db
        .update(schema.settings)
        .set({ 
          value: value,
          updatedAt: new Date()
        })
        .where(eq(schema.settings.key, key))
        .returning();
    } else {
      // Create new setting
      [setting] = await this.db
        .insert(schema.settings)
        .values({
          key: key,
          value: value,
          updatedAt: new Date()
        })
        .returning();
    }
    
    return setting;
  }

  async getAllSettings(): Promise<Settings[]> {
    return await this.db
      .select()
      .from(schema.settings)
      .orderBy(asc(schema.settings.key));
  }

  // User Settings Methods
  async getUserSetting(userId: number, key: string): Promise<string | null> {
    const [setting] = await this.db
      .select()
      .from(schema.userSettings)
      .where(
        and(
          eq(schema.userSettings.userId, userId),
          eq(schema.userSettings.key, key)
        )
      );
    
    return setting?.value ?? null;
  }

  async updateUserSetting(userId: number, key: string, value: string): Promise<UserSettings> {
    // Check if the setting exists
    const existingSetting = await this.db
      .select()
      .from(schema.userSettings)
      .where(
        and(
          eq(schema.userSettings.userId, userId),
          eq(schema.userSettings.key, key)
        )
      );

    if (existingSetting.length > 0) {
      // Update existing setting
      const [updated] = await this.db
        .update(schema.userSettings)
        .set({ value, updatedAt: new Date() })
        .where(
          and(
            eq(schema.userSettings.userId, userId),
            eq(schema.userSettings.key, key)
          )
        )
        .returning();
      return updated;
    } else {
      // Create new setting
      const [newSetting] = await this.db
        .insert(schema.userSettings)
        .values({
          userId,
          key,
          value,
          updatedAt: new Date()
        })
        .returning();
      return newSetting;
    }
  }

  async getUserSettings(userId: number): Promise<UserSettings[]> {
    return await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .orderBy(asc(schema.userSettings.key));
  }
  
  async deleteReview(id: number): Promise<void> {
    // Get the review to determine which official's rating to update after deletion
    const [review] = await this.db
      .select({ officialId: schema.reviews.officialId })
      .from(schema.reviews)
      .where(eq(schema.reviews.id, id));
    
    if (!review) {
      throw new Error("Review not found");
    }
    
    // Delete the review
    await this.db
      .delete(schema.reviews)
      .where(eq(schema.reviews.id, id));
    
    // Update the official's rating
    await this.updateOfficialRating(review.officialId);
  }
}

export const storage = new DatabaseStorage();