import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as schema from "@shared/schema";
import { insertOfficialSchema, insertReviewSchema, insertEventSchema, registerUserSchema, loginUserSchema, insertTeamSchema } from "@shared/schema";
import { ZodError } from "zod";
import passport from "passport";
import session from "express-session";
import MemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import { eq, and } from "drizzle-orm";
import { configurePassport } from "./auth/passport";
import { isAuthenticated, isVerified } from "./auth/middleware";
import { sendVerificationEmail, generateVerificationToken } from "./auth/email";
import { sendEmail } from "./auth/email";
import formidable from "formidable";
import { promises as fs } from "fs";
import path from "path";
import express from "express";
import os from "os";
import { pool } from "./db";

// Use PostgreSQL for session storage to persist across restarts
const PgSession = connectPgSimple(session);

export async function registerRoutes(app: Express) {
  // Configure session and passport
  app.use('/uploads', express.static('uploads'));
  app.use(session({
    store: new PgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'none',
      domain: process.env.NODE_ENV === "production" ? ".replit.app" : undefined
    },
    proxy: true
  }));

  app.use(passport.initialize());
  app.use(passport.session());
  configurePassport(passport);

  // Add admin middleware
  const isAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.isAuthenticated() && req.user?.role === 'admin') {
      next();
    } else {
      res.status(403).json({ message: 'Forbidden' });
    }
  };
  
  // Add middleware for Admin or Regional Supervisor
  const isAdminOrSupervisor = (req: Request, res: Response, next: NextFunction) => {
    if (req.isAuthenticated() && 
       (req.user?.role === 'admin' || req.user?.userType === 'Regional Supervisor')) {
      next();
    } else {
      res.status(403).json({ message: 'Forbidden' });
    }
  };

  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = registerUserSchema.parse(req.body);

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // If user is a coach and has a school, add it to the teams table
      if (userData.userType === "Coach" && userData.school) {
        try {
          // Check if team already exists with this name
          const existingTeams = await storage.getTeams();
          const teamExists = existingTeams.some(team => 
            team.name.toLowerCase() === userData.school?.toLowerCase()
          );
          
          // If the team doesn't exist, create it
          if (!teamExists && userData.school) {
            await storage.createTeam({ name: userData.school });
            console.log(`Created new team from coach's school: ${userData.school}`);
          }
        } catch (error) {
          console.error('Error creating team from school:', error);
          // Continue with user creation even if team creation fails
        }
      }

      // Create user - email verification is not used anymore
      const user = await storage.createUser(userData);
      
      // We're no longer using email verification
      // The user will be marked as verified when an admin approves them

      res.status(201).json({ 
        message: "Thank you for registering. Your account is pending approval from an administrator." 
      });
    } catch (e) {
      if (e instanceof ZodError) {
        return res.status(400).json({ message: "Invalid registration data", errors: e.errors });
      }
      console.error('Registration error:', e);
      res.status(500).json({ message: "Registration failed. Please try again." });
    }
  });

  app.get("/api/auth/verify", async (req, res) => {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({ message: "Verification token required" });
    }

    const success = await storage.verifyUser(token);
    if (!success) {
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    res.json({ message: "Email verified successfully" });
  });

  app.post("/api/auth/login", passport.authenticate("local"), (req, res) => {
    // Return complete user object with all necessary fields
    res.json({
      id: req.user!.id,
      email: req.user!.email,
      firstName: req.user!.firstName,
      lastName: req.user!.lastName,
      role: req.user!.role,
      userType: req.user!.userType,
      school: req.user!.school,
      yearsCoaching: req.user!.yearsCoaching,
      region: req.user!.region,
      yearsExperience: req.user!.yearsExperience,
      photoUrl: req.user!.photoUrl,
      isVerified: req.user!.isVerified
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    // Return complete user object including all profile fields
    res.json({
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      role: req.user.role,
      userType: req.user.userType,
      school: req.user.school,
      yearsCoaching: req.user.yearsCoaching,
      region: req.user.region,
      yearsExperience: req.user.yearsExperience,
      photoUrl: req.user.photoUrl,
      isVerified: req.user.isVerified
    });
  });


  // User management routes
  app.get("/api/users/pending", isAdminOrSupervisor, async (req, res) => {
    try {
      let pendingUsers;
      
      // Regional supervisors can only see users in their region
      if (req.user?.userType === 'Regional Supervisor' && req.user?.region) {
        pendingUsers = await storage.getPendingUsers();
        // Filter to only show coaches in their region
        pendingUsers = pendingUsers.filter(user => 
          user.userType === 'Coach' && user.region === req.user?.region
        );
      } else {
        // Admins can see all pending users
        pendingUsers = await storage.getPendingUsers();
      }
      
      res.json(pendingUsers);
    } catch (error) {
      console.error('Error fetching pending users:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch pending users" 
      });
    }
  });

  app.post("/api/users/:id/verify", isAdminOrSupervisor, async (req, res) => {
    const userId = parseInt(req.params.id);
    const { approved } = req.body;

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (approved) {
      // Directly mark the user as verified
      await storage.updateUserProfile(userId, {
        isVerified: true,
        verificationToken: null,
        verificationExpires: null
      });
      
      try {
        // Send approval email
        await sendEmail(
          user.email,
          "RateMyOfficial Account Approved",
          `<h1>Welcome to RateMyOfficial!</h1>
          <p>Your account has been approved. You can now log in and start using the platform.</p>`
        );
      } catch (error) {
        console.error('Failed to send approval email:', error);
        // Continue with approval even if email fails
      }
    } else {
      await storage.deleteUser(userId);
      // Send rejection email
      await sendEmail(
        user.email,
        "RateMyOfficial Account Status",
        `<h1>RateMyOfficial Account Update</h1>
        <p>We regret to inform you that your account application has not been approved at this time.</p>`
      );
    }

    res.json({ message: "User verification status updated" });
  });
  
  // Add a DELETE route for user management
  app.delete("/api/admin/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      await storage.deleteUser(userId);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to delete user" 
      });
    }
  });

  app.put("/api/users/profile", isAuthenticated, async (req, res) => {
    try {
      console.log('Processing profile update for user:', req.user?.id);
      const uploadsDir = path.join(process.cwd(), "uploads");
      await fs.mkdir(uploadsDir, { recursive: true });

      const form = formidable({
        maxFileSize: 5 * 1024 * 1024,
        uploadDir: uploadsDir,
        keepExtensions: true,
      });

      const [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          resolve([fields, files]);
        });
      });

      // Create updates object with proper type conversion
      const updates: Partial<User> = {};

      // Handle basic fields
      if (fields.firstName?.[0]) updates.firstName = fields.firstName[0];
      if (fields.lastName?.[0]) updates.lastName = fields.lastName[0];
      if (fields.email?.[0]) updates.email = fields.email[0];

      // Handle role-specific fields with proper type conversion
      if (req.user?.userType === "Coach") {
        // If school is updated, check if we need to add it to teams
        if (fields.school?.[0]) {
          const newSchool = fields.school[0];
          updates.school = newSchool;
          
          // Add school to teams if it doesn't exist already
          try {
            // Check if team already exists with this name
            const existingTeams = await storage.getTeams();
            const teamExists = existingTeams.some(team => 
              team.name.toLowerCase() === newSchool.toLowerCase()
            );
            
            // If the team doesn't exist, create it
            if (!teamExists && newSchool) {
              await storage.createTeam({ name: newSchool });
              console.log(`Created new team from coach's updated school: ${newSchool}`);
            }
          } catch (error) {
            console.error('Error creating team from updated school:', error);
            // Continue with user update even if team creation fails
          }
        }
        
        if (fields.yearsCoaching?.[0]) {
          const yearsCoaching = parseInt(fields.yearsCoaching[0], 10);
          if (!isNaN(yearsCoaching)) {
            updates.yearsCoaching = yearsCoaching;
          }
        }
      } else if (req.user?.userType === "Regional Supervisor") {
        if (fields.region?.[0]) updates.region = fields.region[0];
        if (fields.yearsExperience?.[0]) {
          const yearsExperience = parseInt(fields.yearsExperience[0], 10);
          if (!isNaN(yearsExperience)) {
            updates.yearsExperience = yearsExperience;
          }
        }
      }

      // Handle photo upload
      if (files.photo) {
        const photo = Array.isArray(files.photo) ? files.photo[0] : files.photo;
        if (photo.size > 0) {
          updates.photoUrl = `/${path.relative(process.cwd(), photo.filepath)}`;
        }
      }

      console.log('Updating user profile with:', updates);
      const updatedUser = await storage.updateUserProfile(req.user!.id, updates);
      console.log('Profile update successful:', updatedUser);

      // Update session data to reflect changes
      if (req.user) {
        Object.assign(req.user, updatedUser);
      }

      res.json(updatedUser);
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to update profile"
      });
    }
  });

  // Protected routes that require authentication 
  app.post("/api/officials/:id/reviews", isAuthenticated, async (req, res) => {
    try {
      const officialId = parseInt(req.params.id);
      const reviewData = {
        ...req.body,
        officialId,
        userId: req.user!.id // Ensure we have the user ID from the authenticated session
      };

      const review = insertReviewSchema.parse({ ...reviewData, officialId });
      const created = await storage.createReview({ ...review, userId: req.user!.id });
      res.status(201).json(created);
    } catch (e) {
      if (e instanceof ZodError) {
        return res.status(400).json({ message: "Invalid review data", errors: e.errors });
      }
      console.error('Review creation error:', e);
      res.status(500).json({ message: e.message });
    }
  });

  // Existing routes...
  app.get("/api/officials", async (_req, res) => {
    console.log('GET /api/officials - Fetching all officials');
    const officials = await storage.getOfficials();
    console.log('Officials found:', officials);
    res.json(officials);
  });

  app.get("/api/officials/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ message: "Search query required" });
    }
    const results = await storage.searchOfficials(query);
    res.json(results);
  });

  app.get("/api/officials/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const official = await storage.getOfficialById(id);
    if (!official) {
      return res.status(404).json({ message: "Official not found" });
    }
    res.json(official);
  });
  
  // Get reviews for an official
  app.get("/api/officials/:id/reviews", async (req, res) => {
    try {
      const officialId = parseInt(req.params.id);
      const reviews = await storage.getReviewsForOfficial(officialId);
      res.json(reviews);
    } catch (error) {
      console.error('Error fetching reviews:', error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  app.get("/api/events", async (_req, res) => {
    const events = await storage.getEvents();
    res.json(events);
  });

  app.get("/api/events/search", async (req, res) => {
    const query = req.query.q as string;
    const filters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      eventType: req.query.eventType as string,
      venue: req.query.venue as string,
      host: req.query.host as string
    };

    if (!query && !Object.values(filters).some(v => v !== undefined)) {
      return res.status(400).json({ message: "Search query or filters required" });
    }

    const results = await storage.searchEvents(query || "", filters);
    res.json(results);
  });

  app.get("/api/events/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const event = await storage.getEventById(id);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }

      // Get officials assigned to this event
      const officials = await storage.getEventOfficials(id);

      res.json({
        ...event,
        officials: officials.map(official => ({
          officialId: official.id,
          firstName: official.firstName,
          lastName: official.lastName,
          role: official.role
        }))
      });
    } catch (error) {
      console.error('Error fetching event:', error);
      res.status(500).json({ message: "Failed to fetch event details" });
    }
  });

  app.put("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if user is Admin or Regional Supervisor
      const isAdmin = req.user?.role === 'admin';
      const isRegionalSupervisor = req.user?.userType === 'Regional Supervisor';

      if (!isAdmin && !isRegionalSupervisor) {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can update events" });
      }

      // Validate event data
      const event = insertEventSchema.parse(req.body);

      // Ensure at least one official is assigned
      if (!event.officials || event.officials.length === 0) {
        return res.status(400).json({ message: "At least one official must be assigned to the event" });
      }

      // Update the event
      const updatedEvent = await storage.updateEvent(id, event);
      res.json(updatedEvent);
    } catch (error) {
      console.error('Error updating event:', error);
      if (error instanceof ZodError) {
        return res.status(400).json({ message: "Invalid event data", errors: error.errors });
      }
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to update event" });
    }
  });
  
  // Add PATCH endpoint for updating events (for compatibility with the frontend)
  app.patch("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log('PATCH /api/events/:id - Event ID:', id, 'User:', {
        id: req.user?.id,
        email: req.user?.email,
        role: req.user?.role,
        userType: req.user?.userType
      });

      // Check if user is Admin or Regional Supervisor
      const isAdmin = req.user?.role === 'admin';
      const isRegionalSupervisor = req.user?.userType === 'Regional Supervisor';

      if (!isAdmin && !isRegionalSupervisor) {
        console.warn('Authorization failed for event update:', {
          userId: req.user?.id,
          role: req.user?.role,
          userType: req.user?.userType
        });
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can update events" });
      }

      // Validate event data
      console.log('Validating event data:', {
        name: req.body.name,
        date: req.body.date,
        teams: req.body.teams?.length || 0,
        officials: req.body.officials?.length || 0
      });
      
      const event = insertEventSchema.parse(req.body);

      // Ensure at least one official is assigned
      if (!event.officials || event.officials.length === 0) {
        console.warn('Event update validation failed: No officials assigned', {
          eventId: id,
          userId: req.user?.id
        });
        return res.status(400).json({ message: "At least one official must be assigned to the event" });
      }

      // Update the event
      console.log('Calling storage.updateEvent for event ID:', id);
      const updatedEvent = await storage.updateEvent(id, event);
      console.log('Event successfully updated:', {
        id: updatedEvent.id,
        name: updatedEvent.name,
        date: updatedEvent.date
      });
      
      res.json(updatedEvent);
    } catch (error) {
      console.error('Error updating event:', error);
      
      if (error instanceof ZodError) {
        const zodErrors = error.errors.map(e => ({
          path: e.path,
          message: e.message
        }));
        console.error('ZodError validation failed:', zodErrors);
        return res.status(400).json({ message: "Invalid event data", errors: error.errors });
      }
      
      const errorMessage = error instanceof Error ? error.message : "Failed to update event";
      console.error('Server error in event update:', {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
      
      res.status(500).json({ message: errorMessage });
    }
  });

  app.get("/api/events/:id/officials", async (req, res) => {
    const id = parseInt(req.params.id);
    const officials = await storage.getEventOfficials(id);
    res.json(officials);
  });

  // Update the event creation route to allow both Admin and Regional Supervisor roles
  app.post("/api/events", isAuthenticated, async (req, res) => {
    try {
      console.log('Creating event, user:', {
        id: req.user?.id,
        role: req.user?.role,
        userType: req.user?.userType,
        email: req.user?.email
      });

      // Check if user is Admin or Regional Supervisor
      const isAdmin = req.user?.role === 'admin';
      const isRegionalSupervisor = req.user?.userType === 'Regional Supervisor';

      if (!isAdmin && !isRegionalSupervisor) {
        console.log('Authorization failed:', {
          role: req.user?.role,
          userType: req.user?.userType,
          condition: !isAdmin && !isRegionalSupervisor
        });
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can create events" });
      }

      // Validate event data
      const event = insertEventSchema.parse(req.body);

      // Ensure at least one official is assigned
      if (!event.officials || event.officials.length === 0) {
        return res.status(400).json({ message: "At least one official must be assigned to the event" });
      }

      // Create the event
      const created = await storage.createEvent(event);
      res.status(201).json(created);
    } catch (e) {
      if (e instanceof ZodError) {
        return res.status(400).json({ message: "Invalid event data", errors: e.errors });
      }
      console.error('Event creation error:', e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/officials", isAuthenticated, isAdmin, async (req, res) => {
    try {
      console.log('Starting file upload processing...');
      const uploadsDir = path.join(process.cwd(), "uploads");
      await fs.mkdir(uploadsDir, { recursive: true });

      const form = formidable({
        maxFileSize: 5 * 1024 * 1024, // 5MB limit
        uploadDir: uploadsDir,
        keepExtensions: true,
      });

      const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            console.error('Error parsing form:', err);
            reject(err);
          }
          console.log('Form parsed successfully:', { fields: Object.keys(fields), files: Object.keys(files) });
          resolve([fields, files]);
        });
      });

      // Convert fields to the correct types
      const officialData = {
        firstName: fields.firstName[0],
        lastName: fields.lastName[0],
        age: parseInt(fields.age[0]),
        location: fields.location[0],
        association: fields.association[0],
        yearsExperience: parseInt(fields.yearsExperience[0]),
      };

      const official = insertOfficialSchema.parse(officialData);

      // Handle photo upload
      let photoUrl = null;
      if (files.photo) {
        const photo = Array.isArray(files.photo) ? files.photo[0] : files.photo;
        // Use relative path for storage
        photoUrl = path.relative(process.cwd(), photo.filepath);
        console.log('Photo saved:', photoUrl);
      }

      const created = await storage.createOfficial({ ...official, photoUrl });
      console.log('Official created successfully:', created);
      res.status(201).json(created);
    } catch (e) {
      console.error('Error in /api/officials:', e);
      if (e instanceof ZodError) {
        return res.status(400).json({ message: "Invalid official data", errors: e.errors });
      }
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/officials/:id/reviews", async (req, res) => {
    const id = parseInt(req.params.id);
    const reviews = await storage.getReviewsForOfficial(id);
    res.json(reviews);
  });

  app.post("/api/reviews/:id/report", isAuthenticated, async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.reportReview(id);
    res.status(200).json({ message: "Review reported" });
  });
  
  // Add endpoint to delete a review (admin and supervisor only)
  app.delete("/api/reviews/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if user is Admin or Regional Supervisor
      const isAdmin = req.user?.role === 'admin';
      const isRegionalSupervisor = req.user?.userType === 'Regional Supervisor';
      
      if (!isAdmin && !isRegionalSupervisor) {
        return res.status(403).json({ 
          message: "Only Admins and Regional Supervisors can delete reviews"
        });
      }
      
      await storage.deleteReview(id);
      res.status(200).json({ message: "Review deleted successfully" });
    } catch (error) {
      console.error('Error deleting review:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to delete review" 
      });
    }
  });

  // Add this new route after your existing routes
  app.get("/api/officials/:id/events", async (req, res) => {
    const id = parseInt(req.params.id);
    const events = await storage.getEventsForOfficial(id);
    res.json(events);
  });
  
  // Add endpoint to get events for a coach based on their school/team
  app.get("/api/coach/events", isAuthenticated, async (req, res) => {
    try {
      // Check if user is a Coach
      if (req.user?.userType !== 'Coach') {
        return res.status(403).json({ message: "Only Coaches can access this endpoint" });
      }

      const schoolName = req.user.school;
      if (!schoolName) {
        return res.status(400).json({ message: "School is not set in your profile" });
      }
      
      console.log(`Fetching events for coach with school: ${schoolName}`);
      
      // Get events for this coach's school/team
      const events = await storage.getEventsForCoach(schoolName);
      
      console.log(`Found ${events.length} events for school: ${schoolName}`);
      
      res.json(events);
    } catch (error) {
      console.error('Error fetching coach events:', error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  // Add the PATCH route after the other official routes
  app.patch("/api/officials/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      console.log('Starting official update processing...');
      const id = parseInt(req.params.id);
      const uploadsDir = path.join(process.cwd(), "uploads");
      await fs.mkdir(uploadsDir, { recursive: true });

      const form = formidable({
        maxFileSize: 5 * 1024 * 1024, // 5MB limit
        uploadDir: uploadsDir,
        keepExtensions: true,
      });

      const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            console.error('Error parsing form:', err);
            reject(err);
          }
          console.log('Form parsed successfully:', { fields: Object.keys(fields), files: Object.keys(files) });
          resolve([fields, files]);
        });
      });

      // Convert fields to the correct types
      const officialData = {
        firstName: fields.firstName[0],
        lastName: fields.lastName[0],
        age: parseInt(fields.age[0]),
        location: fields.location[0],
        association: fields.association[0],
        yearsExperience: parseInt(fields.yearsExperience[0]),
      };

      const official = insertOfficialSchema.parse(officialData);

      // Handle photo upload
      let photoUrl = undefined;
      if (files.photo) {
        const photo = Array.isArray(files.photo) ? files.photo[0] : files.photo;
        // Use relative path for storage
        photoUrl = path.relative(process.cwd(), photo.filepath);
        console.log('Photo saved:', photoUrl);
      }

      const updated = await storage.updateOfficial(id, { ...official, photoUrl: photoUrl ? `/${photoUrl}` : undefined });
      console.log('Official updated successfully:', updated);
      res.json(updated);
    } catch (e) {
      console.error('Error in PATCH /api/officials/:id:', e);
      if (e instanceof ZodError) {
        return res.status(400).json({ message: "Invalid official data", errors: e.errors });
      }
      res.status(500).json({ message: e.message });
    }
  });

  // Add the delete route after the other official routes
  app.delete("/api/officials/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if user is Admin or Regional Supervisor
      const isAdmin = req.user?.role === 'admin';
      const isRegionalSupervisor = req.user?.userType === 'Regional Supervisor';

      if (!isAdmin && !isRegionalSupervisor) {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can delete officials" });
      }

      await storage.deleteOfficial(id);
      res.status(204).end();
    } catch (error) {
      console.error('Error deleting official:', error);
      res.status(500).json({ message: "Failed to delete official" });
    }
  });

  // Add this route after the other event routes
  app.delete("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if user is Admin or Regional Supervisor
      const isAdmin = req.user?.role === 'admin';
      const isRegionalSupervisor = req.user?.userType === 'Regional Supervisor';

      if (!isAdmin && !isRegionalSupervisor) {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can delete events" });
      }

      await storage.deleteEvent(id);
      res.status(200).json({ message: "Event deleted successfully" });
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  // Add endpoint to refresh all official ratings
  app.post("/api/admin/refresh-ratings", isAuthenticated, async (req, res) => {
    try {
      // Check if user is Admin
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Only Admins can refresh all ratings" });
      }

      console.log("Starting refresh of all official ratings");
      await storage.refreshAllOfficialRatings();
      console.log("Completed refresh of all official ratings");
      
      res.status(200).json({ message: "All official ratings have been refreshed successfully" });
    } catch (error) {
      console.error('Error refreshing official ratings:', error);
      res.status(500).json({ message: "Failed to refresh official ratings" });
    }
  });

  // Coach management endpoints for admin
  app.get("/api/admin/coaches", isAuthenticated, async (req, res) => {
    try {
      // Check if user is Admin or Regional Supervisor
      if (req.user?.role !== 'admin' && req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can access coach management" });
      }

      // Get all verified coaches from the database
      const coaches = await storage.getAllCoaches();

      // Format the coaches for the frontend
      const formattedCoaches = coaches.map(coach => ({
        id: coach.id,
        email: coach.email,
        firstName: coach.firstName,
        lastName: coach.lastName,
        school: coach.school || null,
        yearsCoaching: coach.yearsCoaching || null,
        photoUrl: coach.photoUrl || null,
        region: coach.region || null
      }));

      res.json(formattedCoaches);
    } catch (error) {
      console.error('Error fetching coaches:', error);
      res.status(500).json({ message: "Failed to fetch coaches" });
    }
  });

  // Coach management endpoints for supervisors
  app.get("/api/supervisor/coaches", isAuthenticated, async (req, res) => {
    try {
      // Check if user is Regional Supervisor
      if (req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Regional Supervisors can access this endpoint" });
      }

      // Get region from the supervisor's profile
      const supervisorRegion = req.user.region;
      if (!supervisorRegion) {
        return res.status(400).json({ message: "Supervisor region is not set" });
      }

      // Get coaches filtered by the supervisor's region
      const coaches = await storage.getCoachesByRegion(supervisorRegion);

      // Format the coaches for the frontend
      const formattedCoaches = coaches.map(coach => ({
        id: coach.id,
        email: coach.email,
        firstName: coach.firstName,
        lastName: coach.lastName,
        school: coach.school || null,
        yearsCoaching: coach.yearsCoaching || null,
        photoUrl: coach.photoUrl || null,
        region: coach.region || null
      }));

      res.json(formattedCoaches);
    } catch (error) {
      console.error('Error fetching coaches for supervisor:', error);
      res.status(500).json({ message: "Failed to fetch coaches" });
    }
  });

  // Update coach endpoint for admin
  app.patch("/api/admin/coaches/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if user is Admin or Regional Supervisor
      if (req.user?.role !== 'admin' && req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can update coaches" });
      }

      // Validate the input
      const { firstName, lastName, email, school, yearsCoaching, region } = req.body;
      
      // If school is updated, add it to teams if it doesn't exist already
      if (school) {
        try {
          // Check if team already exists with this name
          const existingTeams = await storage.getTeams();
          const teamExists = existingTeams.some(team => 
            team.name.toLowerCase() === school.toLowerCase()
          );
          
          // If the team doesn't exist, create it
          if (!teamExists) {
            await storage.createTeam({ name: school });
            console.log(`Created new team from coach's updated school by admin: ${school}`);
          }
        } catch (error) {
          console.error('Error creating team from updated school:', error);
          // Continue with user update even if team creation fails
        }
      }
      
      // Update the coach
      const updatedCoach = await storage.updateUserProfile(id, {
        firstName,
        lastName,
        email,
        school,
        region,
        yearsCoaching: yearsCoaching ? parseInt(yearsCoaching) : null
      });

      res.json(updatedCoach);
    } catch (error) {
      console.error('Error updating coach:', error);
      res.status(500).json({ message: "Failed to update coach" });
    }
  });

  // Update coach endpoint for supervisors
  app.patch("/api/supervisor/coaches/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if user is Regional Supervisor
      if (req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Regional Supervisors can update coaches" });
      }

      // Get supervisor's region
      const supervisorRegion = req.user.region;
      if (!supervisorRegion) {
        return res.status(400).json({ message: "Supervisor region is not set" });
      }

      // Get the coach to ensure they're in the supervisor's region
      const coach = await storage.getUserById(id);
      if (!coach) {
        return res.status(404).json({ message: "Coach not found" });
      }

      if (coach.region !== supervisorRegion) {
        return res.status(403).json({ message: "You can only manage coaches in your region" });
      }

      // Validate the input
      const { firstName, lastName, email, school, yearsCoaching } = req.body;
      
      // If school is updated, add it to teams if it doesn't exist already
      if (school) {
        try {
          // Check if team already exists with this name
          const existingTeams = await storage.getTeams();
          const teamExists = existingTeams.some(team => 
            team.name.toLowerCase() === school.toLowerCase()
          );
          
          // If the team doesn't exist, create it
          if (!teamExists) {
            await storage.createTeam({ name: school });
            console.log(`Created new team from coach's updated school by supervisor: ${school}`);
          }
        } catch (error) {
          console.error('Error creating team from updated school:', error);
          // Continue with user update even if team creation fails
        }
      }
      
      // Update the coach, but don't allow changing the region
      const updatedCoach = await storage.updateUserProfile(id, {
        firstName,
        lastName,
        email,
        school,
        yearsCoaching: yearsCoaching ? parseInt(yearsCoaching) : null
      });

      res.json(updatedCoach);
    } catch (error) {
      console.error('Error updating coach:', error);
      res.status(500).json({ message: "Failed to update coach" });
    }
  });

  // Delete coach endpoint for admin
  app.delete("/api/admin/coaches/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if user is Admin or Regional Supervisor
      if (req.user?.role !== 'admin' && req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can delete coaches" });
      }

      // Delete the coach
      await storage.deleteUser(id);
      
      res.json({ message: "Coach deleted successfully" });
    } catch (error) {
      console.error('Error deleting coach:', error);
      res.status(500).json({ message: "Failed to delete coach" });
    }
  });

  // Delete coach endpoint for supervisors
  app.delete("/api/supervisor/coaches/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if user is Regional Supervisor
      if (req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Regional Supervisors can delete coaches" });
      }

      // Get supervisor's region
      const supervisorRegion = req.user.region;
      if (!supervisorRegion) {
        return res.status(400).json({ message: "Supervisor region is not set" });
      }

      // Get the coach to ensure they're in the supervisor's region
      const coach = await storage.getUserById(id);
      if (!coach) {
        return res.status(404).json({ message: "Coach not found" });
      }

      if (coach.region !== supervisorRegion) {
        return res.status(403).json({ message: "You can only manage coaches in your region" });
      }

      // Delete the coach
      await storage.deleteUser(id);
      
      res.json({ message: "Coach deleted successfully" });
    } catch (error) {
      console.error('Error deleting coach:', error);
      res.status(500).json({ message: "Failed to delete coach" });
    }
  });

  // Team routes
  app.get("/api/teams", async (_req, res) => {
    try {
      const teams = await storage.getTeams();
      res.json(teams);
    } catch (error) {
      console.error("Error fetching teams:", error);
      res.status(500).json({ message: "Error fetching teams" });
    }
  });

  app.get("/api/teams/:id", async (req, res) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeamById(teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      res.json(team);
    } catch (error) {
      console.error("Error fetching team:", error);
      res.status(500).json({ message: "Error fetching team" });
    }
  });

  app.post("/api/teams", isAuthenticated, isVerified, async (req, res) => {
    try {
      const team = await storage.createTeam(req.body);
      res.status(201).json(team);
    } catch (error) {
      console.error("Error creating team:", error);
      res.status(500).json({ message: "Error creating team" });
    }
  });
  
  // Update team
  app.patch("/api/teams/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if user is Admin or Regional Supervisor
      if (req.user?.role !== 'admin' && req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can update teams" });
      }

      const team = await storage.updateTeam(id, req.body);
      res.json(team);
    } catch (error) {
      console.error("Error updating team:", error);
      res.status(500).json({ message: "Error updating team" });
    }
  });
  
  // Delete team
  app.delete("/api/teams/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if user is Admin or Regional Supervisor
      if (req.user?.role !== 'admin' && req.user?.userType !== 'Regional Supervisor') {
        return res.status(403).json({ message: "Only Admins and Regional Supervisors can delete teams" });
      }
      
      await storage.deleteTeam(id);
      res.json({ message: "Team deleted successfully" });
    } catch (error) {
      console.error("Error deleting team:", error);
      res.status(500).json({ message: "Error deleting team" });
    }
  });

  app.get("/api/events/:id/teams", async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      const teams = await storage.getEventTeams(eventId);
      res.json(teams);
    } catch (error) {
      console.error("Error fetching event teams:", error);
      res.status(500).json({ message: "Error fetching event teams" });
    }
  });

  // Settings API endpoints
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getAllSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Error fetching settings" });
    }
  });

  app.get("/api/settings/:key", async (req, res) => {
    try {
      const key = req.params.key;
      const value = await storage.getSetting(key);
      if (value === null) {
        return res.status(404).json({ message: "Setting not found" });
      }
      res.json({ key, value });
    } catch (error) {
      console.error(`Error fetching setting ${req.params.key}:`, error);
      res.status(500).json({ message: "Error fetching setting" });
    }
  });

  app.post("/api/settings", isAuthenticated, async (req, res) => {
    try {
      // Only admins can update settings
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ message: "Key and value are required" });
      }
      
      const setting = await storage.updateSetting(key, value);
      res.status(200).json(setting);
    } catch (error) {
      console.error("Error updating setting:", error);
      res.status(500).json({ message: "Error updating setting" });
    }
  });

  // User-specific settings routes
  app.get("/api/user/settings", isAuthenticated, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const userSettings = await storage.getUserSettings(req.user.id);
      res.json(userSettings);
    } catch (error) {
      console.error("Error fetching user settings:", error);
      res.status(500).json({ message: "Error fetching user settings" });
    }
  });

  app.get("/api/user/settings/:key", isAuthenticated, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { key } = req.params;
      const value = await storage.getUserSetting(req.user.id, key);
      if (value === null) {
        return res.status(404).json({ message: "Setting not found" });
      }
      res.json({ key, value });
    } catch (error) {
      console.error("Error fetching user setting:", error);
      res.status(500).json({ message: "Error fetching user setting" });
    }
  });

  app.post("/api/user/settings", isAuthenticated, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { key, value } = req.body;
      if (!key) {
        return res.status(400).json({ message: "Key is required" });
      }

      const updatedSetting = await storage.updateUserSetting(req.user.id, key, value);
      res.json(updatedSetting);
    } catch (error) {
      console.error("Error updating user setting:", error);
      res.status(500).json({ message: "Error updating user setting" });
    }
  });

  // Upload background image
  app.post("/api/settings/upload-background", isAuthenticated, async (req, res) => {
    console.log('Background upload request from user:', req.user);
    if (req.user?.role !== 'admin') {
      console.log('User is not admin, role:', req.user?.role);
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      // Use the newer formidable API
      const form = formidable({
        maxFileSize: 5 * 1024 * 1024, // 5MB limit
        uploadDir: os.tmpdir(),
        keepExtensions: true,
      });
      
      // Parse the form using promises
      const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            console.error("Error parsing form:", err);
            reject(err);
            return;
          }
          resolve([fields, files]);
        });
      });

      // Handle the uploaded file
      const backgroundImage = files.backgroundImage;
      if (!backgroundImage) {
        return res.status(400).json({ message: "No background image provided" });
      }

      // Get the file object, which could be an array depending on formidable version
      const fileObject = Array.isArray(backgroundImage) ? backgroundImage[0] : backgroundImage;

      // Create uploads directory if it doesn't exist
      const uploadsDir = path.join(process.cwd(), "uploads");
      try {
        await fs.mkdir(uploadsDir, { recursive: true });
      } catch (err) {
        console.error("Error creating uploads directory:", err);
      }

      // Generate a unique filename
      const fileId = Date.now().toString(16) + Math.random().toString(16).slice(2);
      
      // Get either the originalFilename or the original name depending on formidable version
      const originalName = fileObject.originalFilename || (fileObject as any).originalName || (fileObject as any).name || "image.jpg";
      let extension = path.extname(originalName).toLowerCase();
      
      if (!extension) {
        extension = ".jpg";  // Default extension
      }

      const filename = fileId + extension;
      const filePath = path.join(uploadsDir, filename);

      // Get the filepath
      const sourcePath = fileObject.filepath || (fileObject as any).path;
      
      if (!sourcePath) {
        console.error("No source path found in file object:", fileObject);
        return res.status(500).json({ message: "Error processing uploaded file" });
      }

      // Move the uploaded file to the uploads directory
      await fs.copyFile(sourcePath, filePath);
      console.log(`Copied image from ${sourcePath} to ${filePath}`);
      
      // Save the background image path in settings
      const imagePath = `/uploads/${filename}`;
      await storage.updateSetting("backgroundImage", imagePath);
      
      // Import the image analysis utility
      const { analyzeAndSaveBackgroundBrightness } = require('./image-utils');
      
      // Analyze the image brightness in the background
      analyzeAndSaveBackgroundBrightness(filePath)
        .catch((err: Error) => console.error('Background analysis error:', err));
      
      res.status(200).json({ 
        message: "Background image uploaded successfully",
        backgroundImage: imagePath
      });
    } catch (error) {
      console.error("Error saving background image:", error);
      res.status(500).json({ message: "Error saving background image" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  userType: string;
  school?: string;
  yearsCoaching?: number;
  region?: string;
  yearsExperience?: number;
  photoUrl?: string;
  isVerified: boolean;
  verificationToken?: string;
}