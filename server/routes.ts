import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "http";
import {
  ReviewValidationError,
  UserVerificationConflictError,
  storage,
} from "./storage";
import * as schema from "@shared/schema";
import { forgotPasswordSchema, insertOfficialSchema, insertReviewSchema, insertEventSchema, registerUserSchema, loginUserSchema, resetPasswordSchema, insertTeamSchema, verifyUserStatusSchema } from "@shared/schema";
import { ZodError } from "zod";
import passport from "passport";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { eq, and } from "drizzle-orm";
import { configurePassport } from "./auth/passport";
import { isAdmin, isAuthenticated, isVerified } from "./auth/middleware";
import { promises as fs } from "fs";
import path from "path";
import { pool } from "./db";
import { User, users, InsertOfficial } from "@shared/schema"; // Assuming 'users' table and User type are available here
import { db } from "./db"; // Assuming 'db' is your Drizzle ORM instance
import { deleteAsset, saveImage, saveVideo, UploadError, VIDEO_MAX_BYTES } from "./upload-service";
import { firstFile, parseImageMultipart, parseVideoMultipart } from "./multipart";
import { logger } from "./logger";
import {
  canManageRegion,
  filterToAuthorizedRegion,
  isAdministrator,
  isRegionalSupervisor,
  normalizeRegion,
} from "./services/permissions";
import {
  debugRoutesEnabled,
  requireSessionSecret,
  sessionCookieOptions,
} from "./session-config";
import bcrypt from "bcryptjs";
import {
  INVALID_RESET_MESSAGE,
  hashPasswordResetToken,
  PasswordResetService,
} from "./auth/password-reset";
import { DatabasePasswordResetRateLimiter } from "./auth/password-reset-rate-limit";
import { withCoachNotificationStatus } from "./email/coach-notification-identity";
import { sensitiveEmailPayloadProtectorFromEnvironment } from "./email/sensitive-payload";
import { registerAdminRegionRoutes } from "./admin-regions";
// Object Storage removed - using local uploads folder only

// Use PostgreSQL for session storage to persist across restarts
const PgSession = connectPgSimple(session);

function sendReviewError(res: Response, error: unknown): Response {
  if (error instanceof ReviewValidationError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    return res.status(409).json({
      message: "You have already reviewed this official for this event",
    });
  }

  logger.error("Review operation failed");
  return res.status(500).json({ message: "Review operation failed" });
}


export async function registerRoutes(app: Express, dependencies: {
  passwordResetLimiter?: DatabasePasswordResetRateLimiter;
} = {}) {
  try {
    const sessionSecret = requireSessionSecret(process.env.SESSION_SECRET);

    const isProduction = process.env.NODE_ENV === "production";
    const forgotPasswordResponse = {
      message:
        "If an account exists for that email address, password reset instructions have been queued.",
    };
    const resetLimiter = dependencies.passwordResetLimiter || new DatabasePasswordResetRateLimiter(db);
    if (isProduction) {
      app.set("trust proxy", 1);
    }

    // Handle CORS preflight for mobile browsers
    app.options('/uploads/*', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.sendStatus(204);
    });

    // Health check endpoint
    app.get("/api/health", async (req, res) => {
      let client;
      try {
        client = await pool.connect();
        await client.query("SELECT 1");
        return res.json({ status: "healthy", database: "connected" });
      } catch {
        return res.status(503).json({
          status: "degraded",
          database: "disconnected",
        });
      } finally {
        client?.release();
      }
    });

    // Serve photos from Object Storage
    app.get('/storage/:path(*)', async (req, res) => {
      try {
        const { Client } = await import('@replit/object-storage');
        const objectStorage = new Client();
        
        const objectPath = req.params.path;
        const downloadResult = await objectStorage.downloadAsBytes(objectPath);
        if (!downloadResult.ok) {
          throw new Error(downloadResult.error.message);
        }
        const [fileBuffer] = downloadResult.value;
        
        const ext = path.extname(objectPath).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.heic': 'image/heic',
          '.heif': 'image/heif'
        };
        
        res.setHeader('Content-Type', contentTypes[ext] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(fileBuffer);
      } catch (error) {
        console.error('Error serving photo from Object Storage:', error);
        res.status(404).send('File not found');
      }
    });

    app.use(session({
      store: new PgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: sessionCookieOptions(isProduction),
      proxy: isProduction
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    configurePassport(passport);
    registerAdminRegionRoutes(app, storage);
    // Add middleware for Admin or Regional Supervisor
    const isAdminOrSupervisor = (req: Request, res: Response, next: NextFunction) => {
      if (req.isAuthenticated() &&
        (req.user?.role === 'admin' || isRegionalSupervisor(req.user))) {
        next();
      } else {
        res.status(403).json({ message: 'Forbidden' });
      }
    };

    const canManageTargetRegion = (
      req: Request,
      res: Response,
      targetRegion: string | null | undefined,
    ): boolean => {
      if (canManageRegion(req.user, targetRegion)) {
        return true;
      }
      res.status(403).json({ message: "Forbidden for this region" });
      return false;
    };

    const eventResourcesAreAuthorized = async (
      req: Request,
      event: schema.InsertEvent,
    ): Promise<boolean> => {
      if (isAdministrator(req.user)) {
        return true;
      }
      if (!canManageRegion(req.user, event.region)) {
        return false;
      }

      for (const assignment of event.officials || []) {
        const official = await storage.getOfficialById(assignment.officialId);
        if (!official || !canManageRegion(req.user, official.association)) {
          return false;
        }
      }

      for (const teamId of event.teams || []) {
        const team = await storage.getTeamById(teamId);
        if (!team || !canManageRegion(req.user, team.region)) {
          return false;
        }
      }
      return true;
    };

    // Auth routes
    app.post("/api/auth/register", async (req, res) => {
      try {
        logger.debug("Registration started");
        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

        // Extract user data from fields
        const userType = fields.userType?.[0] as 'Coach' | 'Regional Supervisor' || 'Coach';
        const userData: any = {
          firstName: fields.firstName?.[0]?.trim() || '',
          lastName: fields.lastName?.[0]?.trim() || '',
          email: fields.email?.[0]?.trim().toLowerCase() || '',
          password: fields.password?.[0] || '',
          confirmPassword: fields.confirmPassword?.[0] || fields.password?.[0] || '',
          userType: userType,
        };

        // Add role-specific fields
        if (userType === 'Coach') {
          userData.school = fields.school?.[0]?.trim();
          if (fields.yearsCoaching?.[0]) {
            userData.yearsCoaching = parseInt(fields.yearsCoaching[0], 10);
          }
        } else if (userType === 'Regional Supervisor') {
          userData.region = fields.region?.[0]?.trim();
          if (fields.yearsExperience?.[0]) {
            userData.yearsExperience = parseInt(fields.yearsExperience[0], 10);
          }
        }

        // Validate with schema
        const validatedData = registerUserSchema.parse(userData);

        // Check if user already exists
        const existingUser = await storage.getUserByEmail(validatedData.email);
        if (existingUser) {
          return res.status(400).json({ message: "Email already registered" });
        }

        // If user is a coach and has a school, add it to the teams table
        if (validatedData.userType === "Coach" && validatedData.school) {
          try {
            const existingTeams = await storage.getTeams();
            const existingTeam = existingTeams.find(team =>
              team.name.toLowerCase() === validatedData.school?.toLowerCase()
            );
            if (existingTeam?.region) {
              validatedData.region = existingTeam.region;
            }
          } catch (error) {
            logger.warn("Unable to derive coach region");
          }
        }

        let savedPhotoUrl: string | null = null;
        // Images are decoded and converted by the upload service; client names
        // and MIME declarations are never used as storage metadata.
        if (files.photo) {
          const photo = firstFile(files, "photo");
          if (photo && photo.size > 0) {
            try {
              const asset = await saveImage(photo);
              savedPhotoUrl = asset.url;
            } catch (photoError) {
              if (photoError instanceof UploadError) return res.status(photoError.statusCode).json({ message: photoError.message });
              throw photoError;
            }
          }
        }

        try {
          await storage.createUserWithRegistrationEmail(
            validatedData,
            savedPhotoUrl,
          );
          savedPhotoUrl = null;
        } catch (error) {
          await deleteAsset(savedPhotoUrl);
          throw error;
        }

        res.status(201).json({
          message: "Thank you for registering. Your account is pending approval from an administrator."
        });
      } catch (e) {
        if (e instanceof ZodError) {
          return res.status(400).json({ message: "Invalid registration data", errors: e.errors });
        }
        logger.error("Registration failed");
        res.status(500).json({ message: "Registration failed. Please try again." });
      }
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

    app.post("/api/auth/forgot-password", async (req, res) => {
      const responseStartedAt = Date.now();
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (parsed.success) {
        const normalizedEmail = parsed.data.email.toLowerCase();
        try {
          const ipAllowed = await resetLimiter.allow("ip", req.ip || "unknown", 5, 15 * 60_000);
          const emailAllowed = ipAllowed &&
            await resetLimiter.allow("email", normalizedEmail, 3, 15 * 60_000);
          if (ipAllowed && emailAllowed) {
            const resetService = new PasswordResetService(
              db,
              sensitiveEmailPayloadProtectorFromEnvironment(),
              process.env.APP_URL,
            );
            await resetService.requestReset(normalizedEmail);
          }
        } catch {
          logger.error("Password reset request could not be queued");
        }
      }
      const minimumResponseMs = 250;
      const remainingDelay = minimumResponseMs - (Date.now() - responseStartedAt);
      if (remainingDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingDelay));
      }
      return res.json(forgotPasswordResponse);
    });

    app.post("/api/auth/reset-password", async (req, res) => {
      try {
        if (!await resetLimiter.allow("reset-ip", req.ip || "unknown", 20, 15 * 60_000)) {
          return res.status(429).json({ message: "Too many reset attempts. Please try again later." });
        }
      } catch {
        return res.status(503).json({ message: "Password reset is temporarily unavailable" });
      }
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: INVALID_RESET_MESSAGE });
      }
      try {
        const resetService = new PasswordResetService(db);
        await resetService.resetPassword(
          parsed.data.token,
          parsed.data.newPassword,
        );
        return res.json({ message: "Password updated successfully" });
      } catch {
        return res.status(400).json({ message: INVALID_RESET_MESSAGE });
      }
    });

    app.post("/api/auth/logout", (req, res) => {
      req.logout((err) => {
        if (err) {
          logger.error("Logout failed");
          return res.status(500).json({ message: "Error during logout" });
        }
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
        const pendingUsers = await storage.getPendingUsers();
        res.json(filterToAuthorizedRegion(req.user, pendingUsers));
      } catch (error) {
        logger.error("Failed to fetch pending users");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to fetch pending users"
        });
      }
    });

    app.get("/api/users/supervisors", isAdminOrSupervisor, async (req, res) => {
      try {
        // Get all Regional Supervisors
        const supervisors = filterToAuthorizedRegion(
          req.user,
          await storage.getUsersByType('Regional Supervisor'),
        );

        // Format the response to match frontend expectations
        const formattedSupervisors = supervisors.map(supervisor => ({
          id: supervisor.id,
          email: supervisor.email,
          firstName: supervisor.firstName,
          lastName: supervisor.lastName,
          region: supervisor.region || null,
          yearsExperience: supervisor.yearsExperience || null,
          photoUrl: supervisor.photoUrl || null,
          verified: supervisor.isVerified
        }));

        res.json({
          data: formattedSupervisors,
          total: formattedSupervisors.length
        });
      } catch (error) {
        logger.error("Failed to fetch supervisors");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to fetch supervisors"
        });
      }
    });

    app.post("/api/users/:id/verify", isAdminOrSupervisor, async (req, res) => {
      const userId = parseInt(req.params.id);
      const parsedDecision = verifyUserStatusSchema.safeParse(req.body);
      if (!parsedDecision.success) {
        return res.status(400).json({
          message: "Request body must contain only a boolean approved field",
        });
      }
      const { approved } = parsedDecision.data;

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!canManageTargetRegion(req, res, user.region)) {
        return;
      }

      try {
        const updatedUser = await storage.verifyUserWithStatusEmail(
          userId,
          approved,
        );
        if (!updatedUser) {
          return res.status(404).json({ message: "User not found" });
        }
      } catch (error) {
        if (error instanceof UserVerificationConflictError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        logger.error("User verification failed");
        return res.status(500).json({ message: "User verification failed" });
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
        logger.error("User deletion failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to delete user"
        });
      }
    });

    app.put("/api/users/profile", isAuthenticated, async (req, res) => {
      try {
        logger.debug("Profile update started");
        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

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
                await storage.createTeam({
                  name: newSchool,
                  region: req.user?.region || null,
                });
                logger.info("Coach team created during profile update");
              }
            } catch (error) {
              logger.warn("Coach team creation failed during profile update");
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
          if (fields.yearsExperience?.[0]) {
            const yearsExperience = parseInt(fields.yearsExperience[0], 10);
            if (!isNaN(yearsExperience)) {
              updates.yearsExperience = yearsExperience;
            }
          }
        }

        // Store profile photos through the authoritative validated upload service.
        if (files.photo) {
          const photo = firstFile(files, "photo");
          if (photo && photo.size > 0) {
            try {
              updates.photoUrl = (await saveImage(photo)).url;
            } catch (error) {
              if (error instanceof UploadError) return res.status(error.statusCode).json({ message: error.message });
              logger.error("Profile photo processing failed");
              return res.status(500).json({
                message: "Error processing uploaded photo. Please try again.",
                details: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
        }

        const updatedUser = await storage.updateUserProfile(req.user!.id, updates);
        logger.info("Profile update successful");

        // Update session data to reflect changes
        if (req.user) {
          Object.assign(req.user, updatedUser);
        }

        res.json(updatedUser);
      } catch (error) {
        logger.error("Profile update failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to update profile"
        });
      }
    });

    // Protected routes that require authentication
    app.post("/api/officials/:id/reviews", isAuthenticated, async (req, res) => {
      try {
        const officialId = parseInt(req.params.id);

        // Handle form data for video uploads
        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseVideoMultipart(req, VIDEO_MAX_BYTES);

        // Extract review data from fields
        const reviewData = {
          officialId,
          userId: req.user!.id,
          eventId: parseInt(fields.eventId?.[0] || '0'),
          mechanics: parseInt(fields.mechanics?.[0] || '', 10),
          professionalism: parseInt(fields.professionalism?.[0] || '', 10),
          positioning: parseInt(fields.positioning?.[0] || '', 10),
          stalling: parseInt(fields.stalling?.[0] || '', 10),
          consistency: parseInt(fields.consistency?.[0] || '', 10),
          appearance: parseInt(fields.appearance?.[0] || '', 10),
          comment: fields.comment?.[0] || "",
          isAnonymous: false
        };

        // Handle video upload
        let videoUrl = null;
        if (files.video) {
          const video = firstFile(files, "video");
          if (video && video.size > 0) {
            try {
              videoUrl = (await saveVideo(video)).url;
            } catch (videoError) {
              if (videoError instanceof UploadError) return res.status(videoError.statusCode).json({ message: videoError.message });
              logger.error("Review video processing failed");
              return res.status(500).json({ message: "Error processing uploaded video. Please try again." });
            }
          }
        }

        let created;
        try {
          created = await storage.createReview({ ...reviewData, videoUrl });
        } catch (error) {
          await deleteAsset(videoUrl);
          throw error;
        }
        res.status(201).json(created);
      } catch (e) {
        if (e instanceof ZodError) {
          return res.status(400).json({ message: "Invalid review data", errors: e.errors });
        }
        return sendReviewError(res, e);
      }
    });

    // Existing routes...
    app.get("/api/officials", async (_req, res) => {
      console.log('GET /api/officials - Fetching all officials');
      try {
        const officialsResponse = await storage.getOfficials();
        console.log('Officials response:', officialsResponse);

        // Handle both old and new response formats
        const officials = officialsResponse.data || [];
        const total = officialsResponse.total || 0;

        console.log('Officials found:', total, 'officials');
        if (officials.length > 0) {
          console.log('Official names:', officials.map(o => `${o.firstName} ${o.lastName}`));
        }

        res.json({
          data: officials,
          total: total
        });
      } catch (error) {
        console.error('Error fetching officials:', error);
        res.status(500).json({
          message: 'Failed to fetch officials',
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    app.get("/api/officials/search", async (req, res) => {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: "Search query required" });
      }

      // Validate and sanitize search query
      if (query.length > 100) {
        return res.status(400).json({ message: "Search query too long" });
      }

      if (query.trim().length === 0) {
        return res.status(400).json({ message: "Search query cannot be empty" });
      }

      try {
        const results = await storage.searchOfficials(query.trim());
        res.json(results);
      } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ message: "Search failed" });
      }
    });

    app.get("/api/officials/:id", async (req, res) => {
      const id = parseInt(req.params.id);
      const official = await storage.getOfficialById(id);
      if (!official) {
        return res.status(404).json({ message: "Official not found" });
      }
      res.json(official);
    });

    app.get("/api/officials/slug/:slug", async (req, res) => {
      try {
        const slug = req.params.slug;
        console.log(`Fetching official by slug: ${slug}`);
        const official = await storage.getOfficialBySlug(slug);
        if (!official) {
          console.log(`Official not found for slug: ${slug}`);
          return res.status(404).json({ message: "Official not found" });
        }
        console.log(`Official found: ${official.firstName} ${official.lastName}`);
        res.json(official);
      } catch (error) {
        console.error('Error fetching official by slug:', error);
        res.status(500).json({
          message: "Failed to fetch official",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    app.get("/api/officials/:id/rating-breakdown", async (req, res) => {
      const officialId = parseInt(req.params.id, 10);
      if (!Number.isInteger(officialId) || officialId <= 0) {
        return res.status(400).json({ message: "Invalid official ID" });
      }

      const official = await storage.getOfficialById(officialId);
      if (!official) {
        return res.status(404).json({ message: "Official not found" });
      }

      res.json(await storage.getOfficialRatingBreakdown(officialId));
    });

    app.get("/api/officials/slug/:slug/rating-breakdown", async (req, res) => {
      const official = await storage.getOfficialBySlug(req.params.slug);
      if (!official) {
        return res.status(404).json({ message: "Official not found" });
      }

      res.json(await storage.getOfficialRatingBreakdown(official.id));
    });

    // Get reviews for an official
    app.get("/api/officials/:id/reviews", async (req, res) => {
      try {
        const officialId = parseInt(req.params.id);
        const official = await storage.getOfficialById(officialId);
        if (!official) {
          return res.status(404).json({ message: "Official not found" });
        }
        const showPending =
          isAdministrator(req.user) ||
          (isRegionalSupervisor(req.user) &&
            canManageRegion(req.user, official.association));
        const reviews = await storage.getReviewsForOfficial(officialId, showPending);
        res.json(reviews);
      } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ message: "Failed to fetch reviews" });
      }
    });

    app.get("/api/officials/slug/:slug/reviews", async (req, res) => {
      try {
        const slug = req.params.slug;
        console.log(`Fetching reviews for slug: ${slug}`);
        const official = await storage.getOfficialBySlug(slug);
        if (!official) {
          console.log(`Official not found for slug: ${slug}`);
          return res.status(404).json({ message: "Official not found" });
        }
        const showPending =
          isAdministrator(req.user) ||
          (isRegionalSupervisor(req.user) &&
            canManageRegion(req.user, official.association));
        const reviews = await storage.getReviewsForOfficial(official.id, showPending);
        res.json(reviews);
      } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({
          message: "Failed to fetch reviews",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    app.get("/api/officials/slug/:slug/events", async (req, res) => {
      try {
        const slug = req.params.slug;
        console.log(`Fetching events for slug: ${slug}`);
        const official = await storage.getOfficialBySlug(slug);
        if (!official) {
          console.log(`Official not found for slug: ${slug}`);
          return res.status(404).json({ message: "Official not found" });
        }
        const events = await storage.getEventsForOfficial(official.id);
        console.log(`Found ${events.length} events for ${official.firstName} ${official.lastName}`);
        res.json(events);
      } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({
          message: "Failed to fetch events",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    app.get("/api/events", async (_req, res) => {
      logger.debug("Fetching events");
      try {
        const events = await storage.getEvents();
        logger.debug("Fetched events", { count: events.length });
        // Ensure we always return an array
        const eventsArray = Array.isArray(events) ? events : [];
        res.json(eventsArray);
      } catch (error) {
        logger.error("Events fetch failed");
        res.status(500).json({ message: 'Failed to fetch events' });
      }
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
            role: (official as schema.Official & { role?: string | null }).role
          }))
        });
      } catch (error) {
        logger.error("Event fetch failed");
        res.status(500).json({ message: "Failed to fetch event details" });
      }
    });

    app.put("/api/events/:id", isAuthenticated, async (req, res) => {
      try {
        const id = parseInt(req.params.id);

        // Check if user is Admin or Regional Supervisor
        const isAdmin = req.user?.role === 'admin';
        const supervisorAuthorized = isRegionalSupervisor(req.user);

        if (!isAdmin && !supervisorAuthorized) {
          return res.status(403).json({ message: "Only Admins and Regional Supervisors can update events" });
        }

        const existingEvent = await storage.getEventById(id);
        if (!existingEvent) {
          return res.status(404).json({ message: "Event not found" });
        }
        if (!canManageTargetRegion(req, res, existingEvent.region)) {
          return;
        }

        // Validate event data
        const event = insertEventSchema.parse({
          ...req.body,
          region: isAdministrator(req.user) ? req.body.region : req.user?.region,
        });
        if (!(await eventResourcesAreAuthorized(req, event))) {
          return res.status(403).json({ message: "Event resources must be in your region" });
        }

        // Ensure at least one official is assigned
        if (!event.officials || event.officials.length === 0) {
          return res.status(400).json({ message: "At least one official must be assigned to the event" });
        }

        // Update the event
        const updatedEvent = await storage.updateEvent(id, event);
        res.json(updatedEvent);
      } catch (error) {
        logger.error("Event update failed");
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

        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid event ID" });
        }

        // Check if user exists and is authenticated
        if (!req.user) {
          logger.warn("Event update missing authenticated user");
          return res.status(401).json({ message: "Authentication required" });
        }

        // Check if user is Admin or Regional Supervisor
        const isAdmin = req.user.role === 'admin';
        const supervisorAuthorized = isRegionalSupervisor(req.user);

        if (!isAdmin && !supervisorAuthorized) {
          logger.warn("Event update authorization denied");
          return res.status(403).json({ message: "Only Admins and Regional Supervisors can update events" });
        }

        // Verify event exists before attempting update
        const existingEvent = await storage.getEventById(id);
        if (!existingEvent) {
          return res.status(404).json({ message: "Event not found" });
        }
        if (!canManageTargetRegion(req, res, existingEvent.region)) {
          return;
        }

        // Validate event data
        const event = insertEventSchema.parse({
          ...req.body,
          region: isAdministrator(req.user) ? req.body.region : req.user.region,
        });
        if (!(await eventResourcesAreAuthorized(req, event))) {
          return res.status(403).json({ message: "Event resources must be in your region" });
        }

        // Ensure at least one official is assigned
        if (!event.officials || event.officials.length === 0) {
          logger.warn("Event update validation failed");
          return res.status(400).json({ message: "At least one official must be assigned to the event" });
        }

        // Update the event
        const updatedEvent = await storage.updateEvent(id, event);
        logger.info("Event updated");

        res.json(updatedEvent);
      } catch (error) {
        logger.error("Event update failed");

        if (error instanceof ZodError) {
          logger.warn("Event update validation failed");
          return res.status(400).json({ message: "Invalid event data", errors: error.errors });
        }

        res.status(500).json({ message: "Failed to update event" });
      }
    });

    app.get("/api/events/:id/officials", async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        logger.debug("Fetching event officials");
        const officials = await storage.getEventOfficials(id);
        logger.debug("Fetched event officials", { count: officials.length });
        res.json(officials);
      } catch (error) {
        logger.error("Event officials fetch failed");
        res.status(500).json({ message: 'Failed to fetch event officials' });
      }
    });

    app.get("/api/events/:id/teams", async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        logger.debug("Fetching event teams");
        const teams = await storage.getEventTeams(id);
        logger.debug("Fetched event teams", { count: teams.length });
        res.json(teams);
      } catch (error) {
        logger.error("Event teams fetch failed");
        res.status(500).json({ message: 'Failed to fetch event teams' });
      }
    });

    // Update the event creation route to allow both Admin and Regional Supervisor roles
    app.post("/api/events", isAuthenticated, async (req, res) => {
      try {
        if (!req.user) {
          logger.warn("Event creation missing authenticated user");
          return res.status(401).json({ message: "Authentication required. Please log in again." });
        }

        // Check if user is Admin or Regional Supervisor
        const isAdmin = req.user.role === 'admin';
        const supervisorAuthorized = isRegionalSupervisor(req.user);

        if (!isAdmin && !supervisorAuthorized) {
          logger.warn("Event creation authorization denied");
          return res.status(403).json({ message: "Only Admins and Regional Supervisors can create events" });
        }

        // Validate event data
        const event = insertEventSchema.parse({
          ...req.body,
          region: isAdministrator(req.user) ? req.body.region : req.user.region,
        });
        if (!(await eventResourcesAreAuthorized(req, event))) {
          return res.status(403).json({ message: "Event resources must be in your region" });
        }

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
        logger.error("Event creation failed");
        res.status(500).json({ message: e instanceof Error ? e.message : "Failed to create event" });
      }
    });

    app.post("/api/officials", isAuthenticated, isAdmin, async (req, res) => {
      try {
        logger.debug("Official creation started");
        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

        // Convert fields to the correct types with validation
        const officialData = {
          firstName: fields.firstName?.[0]?.trim() || '',
          lastName: fields.lastName?.[0]?.trim() || '',
          age: parseInt(fields.age?.[0] || '0'),
          location: fields.location?.[0]?.trim() || '',
          association: fields.association?.[0]?.trim() || '',
          yearsExperience: parseInt(fields.yearsExperience?.[0] || '0'),
        };

        // Validate required fields before schema parsing
        if (!officialData.firstName || !officialData.lastName) {
          return res.status(400).json({ message: "First name and last name are required" });
        }

        if (isNaN(officialData.age) || officialData.age <= 0) {
          return res.status(400).json({ message: "Valid age is required" });
        }

        if (isNaN(officialData.yearsExperience) || officialData.yearsExperience < 0) {
          return res.status(400).json({ message: "Valid years of experience is required" });
        }

        const official = insertOfficialSchema.parse(officialData);

        // Decode and normalize image bytes before publishing them.
        let photoUrl: string | undefined;
        if (files.photo) {
          const photo = firstFile(files, "photo");
          if (photo && photo.size > 0) {
            try {
              photoUrl = (await saveImage(photo)).url;
            } catch (error) {
              if (error instanceof UploadError) return res.status(error.statusCode).json({ message: error.message });
              throw error;
            }
          }
        }

        const created = await storage.createOfficial({ ...official, photoUrl });
        logger.info("Official created");

        res.status(201).json(created);
      } catch (e) {
        logger.error("Official creation failed");
        if (e instanceof ZodError) {
          return res.status(400).json({ message: "Invalid official data", errors: e.errors });
        }
        res.status(500).json({ message: e instanceof Error ? e.message : "Failed to create official" });
      }
    });

    app.patch("/api/officials/:id", isAuthenticated, isAdmin, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        logger.debug("Official update started");

        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

        // Convert fields to the correct types
        const officialData: Partial<InsertOfficial> & { photoUrl?: string } = {};

        if (fields.firstName?.[0]) officialData.firstName = fields.firstName[0].trim();
        if (fields.lastName?.[0]) officialData.lastName = fields.lastName[0].trim();
        if (fields.age?.[0]) officialData.age = parseInt(fields.age[0]);
        if (fields.location?.[0]) officialData.location = fields.location[0].trim();
        if (fields.association?.[0]) officialData.association = fields.association[0].trim();
        if (fields.yearsExperience?.[0]) officialData.yearsExperience = parseInt(fields.yearsExperience[0]);

        // Decode and normalize image bytes before publishing them.
        if (files.photo) {
          const photo = firstFile(files, "photo");

          if (photo && photo.size > 0) {
            try {
              officialData.photoUrl = (await saveImage(photo)).url;
            } catch (error) {
              if (error instanceof UploadError) return res.status(error.statusCode).json({ message: error.message });
              throw error;
            }
          }
        }

        logger.debug("Updating official");
        const updated = await storage.updateOfficial(id, officialData);
        logger.info("Official updated");

        res.json(updated);
      } catch (e) {
        logger.error("Official update failed");
        if (e instanceof ZodError) {
          return res.status(400).json({ message: "Invalid official data", errors: e.errors });
        }
        res.status(500).json({ message: e instanceof Error ? e.message : "Failed to update official" });
      }
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
        const supervisorAuthorized = isRegionalSupervisor(req.user);

        if (!isAdmin && !supervisorAuthorized) {
          return res.status(403).json({
            message: "Only Admins and Regional Supervisors can delete reviews"
          });
        }

        const review = await storage.getReviewById(id);
        if (!review) {
          return res.status(404).json({ message: "Review not found" });
        }
        const official = await storage.getOfficialById(review.officialId);
        if (!official || !canManageTargetRegion(req, res, official.association)) {
          return;
        }

        await storage.deleteReview(id);
        await deleteAsset(review.videoUrl);
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

        logger.debug("Fetching coach events");

        // Get events for this coach's school/team
        const events = await storage.getEventsForCoach(schoolName);

        logger.debug("Fetched coach events", { count: events.length });

        res.json(events);
      } catch (error) {
        console.error('Error fetching coach events:', error);
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to fetch events"
        });
      }
    });

    // Get all coaches (admin and supervisor endpoint)
    app.get("/api/admin/coaches", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        logger.debug("Fetching managed coaches");
        const coaches = filterToAuthorizedRegion(
          req.user,
          await storage.getUsersByType('Coach'),
        );
        // Sort coaches alphabetically by last name
        coaches.sort((a, b) => a.lastName.localeCompare(b.lastName));
        logger.debug("Fetched managed coaches", { count: coaches.length });
        res.json(await withCoachNotificationStatus(db, coaches));
      } catch (error) {
        logger.error("Managed coaches fetch failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to fetch coaches"
        });
      }
    });

    // Create a new coach (admin endpoint) - same as supervisor endpoint
    app.post("/api/admin/coaches", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        logger.debug("Admin coach creation started");
        logger.debug("Coach creation requested");

        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

        // Extract and validate required fields
        const firstName = fields.firstName?.[0]?.trim();
        const lastName = fields.lastName?.[0]?.trim();
        const email = fields.email?.[0]?.trim().toLowerCase();
        const password = fields.password?.[0];
        const school = fields.school?.[0]?.trim();

        logger.debug("Admin coach fields parsed");

        if (!firstName || !lastName || !email || !password || !school) {
          logger.warn("Admin coach creation missing required fields");
          return res.status(400).json({ message: "All required fields must be provided" });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          logger.warn("Invalid email format on coach creation");
          return res.status(400).json({ message: "Invalid email format" });
        }

        // Check if email already exists
        logger.debug("Checking coach email availability");
        const existingUser = await storage.getUserByEmail(email);
        if (existingUser) {
          logger.warn("Coach email already exists");
          return res.status(400).json({ message: "A user with this email already exists" });
        }

        // Parse years coaching with validation
        let yearsCoaching = 0;
        if (fields.yearsCoaching?.[0]) {
          const parsed = parseInt(fields.yearsCoaching[0], 10);
          yearsCoaching = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
        }
        logger.debug("Admin coach years parsed");

        // Add school to teams if it doesn't exist
        logger.debug("Managing coach team assignment");
        try {
          const existingTeams = await storage.getTeams();
          const teamExists = existingTeams.some(team =>
            team.name.toLowerCase() === school.toLowerCase()
          );
          if (!teamExists) {
            logger.debug("Creating coach team");
            await storage.createTeam({
              name: school,
              region: isRegionalSupervisor(req.user) ? req.user?.region : null,
            });
            logger.info("Coach team created");
          } else {
            logger.debug("Coach team already exists");
          }
        } catch (teamError) {
          logger.warn("Coach team management failed");
          // Don't fail coach creation if team creation fails
        }

        // Create the coach user
        const coachData = {
          firstName,
          lastName,
          email,
          password,
          confirmPassword: password,
          userType: 'Coach' as const,
          school,
          yearsCoaching,
          isVerified: true,
          region: isRegionalSupervisor(req.user) ? req.user?.region : null,
        };

        logger.debug("Creating administrator-managed coach");

        const coach = await storage.createUser(coachData);
        logger.info("Administrator-managed coach created");

        // Handle optional photo upload before sending response
        const photoFile = firstFile(files, "photo");
        if (photoFile && photoFile.size > 0) {
          logger.debug("Processing coach photo upload");
          try {
            const photoUrl = (await saveImage(photoFile)).url;

            const updatedCoach = await storage.updateUserProfile(coach.id, { photoUrl });
            logger.info("Coach photo updated");

            // Clean up temp file
            try {
              await fs.unlink(photoFile.filepath);
              logger.debug("Temporary upload cleaned up");
            } catch (cleanupError) {
              logger.warn("Temporary upload cleanup failed");
            }

            // Return updated coach with photo URL
            logger.info("Admin coach creation completed");
            return res.status(201).json(updatedCoach);
          } catch (photoError) {
            logger.warn("Coach photo processing failed");
            // Photo processing failed, but coach was created successfully
          }
        } else {
          logger.debug("Coach created without photo");
        }

        // Return coach (with or without photo, depending on upload success)
        logger.info("Admin coach creation completed");
        return res.status(201).json(coach);
      } catch (error) {
        logger.error("Admin coach creation failed");
        return res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to create coach"
        });
      }
    });

    // Supervisor endpoint for coaches - same as admin, no region filtering
    app.get("/api/supervisor/coaches", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        logger.debug("Fetching managed coaches");
        const coaches = filterToAuthorizedRegion(
          req.user,
          await storage.getUsersByType('Coach'),
        );
        logger.debug("Fetched managed coaches", { count: coaches.length });
        res.json(await withCoachNotificationStatus(db, coaches));
      } catch (error) {
        logger.error("Managed coaches fetch failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to fetch coaches"
        });
      }
    });

    // Create a new coach (supervisor endpoint)
    app.post("/api/supervisor/coaches", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        logger.debug("Supervisor coach creation started");
        logger.debug("Supervisor coach creation requested");

        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

        // Extract and validate required fields
        const firstName = fields.firstName?.[0]?.trim();
        const lastName = fields.lastName?.[0]?.trim();
        const email = fields.email?.[0]?.trim().toLowerCase();
        const password = fields.password?.[0];
        const school = fields.school?.[0]?.trim();

        logger.debug("Supervisor coach fields parsed");

        if (!firstName || !lastName || !email || !password || !school) {
          logger.warn("Supervisor coach creation missing required fields");
          return res.status(400).json({ message: "All required fields must be provided" });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          logger.warn("Invalid email format on coach creation");
          return res.status(400).json({ message: "Invalid email format" });
        }

        // Check if email already exists
        logger.debug("Checking coach email availability");
        const existingUser = await storage.getUserByEmail(email);
        if (existingUser) {
          logger.warn("Coach email already exists");
          return res.status(400).json({ message: "A user with this email already exists" });
        }

        // Parse years coaching with validation
        let yearsCoaching = 0;
        if (fields.yearsCoaching?.[0]) {
          const parsed = parseInt(fields.yearsCoaching[0], 10);
          yearsCoaching = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
        }
        logger.debug("Supervisor coach years parsed");

        // Add school to teams if it doesn't exist
        logger.debug("Managing coach team assignment");
        try {
          const existingTeams = await storage.getTeams();
          const teamExists = existingTeams.some(team =>
            team.name.toLowerCase() === school.toLowerCase()
          );
          if (!teamExists) {
            logger.debug("Creating coach team");
            await storage.createTeam({
              name: school,
              region: isRegionalSupervisor(req.user) ? req.user?.region : null,
            });
            logger.info("Coach team created");
          } else {
            logger.debug("Coach team already exists");
          }
        } catch (teamError) {
          logger.warn("Coach team management failed");
          // Don't fail coach creation if team creation fails
        }

        // Create the coach user
        const coachData = {
          firstName,
          lastName,
          email,
          password,
          confirmPassword: password,
          userType: 'Coach' as const,
          school,
          yearsCoaching,
          isVerified: true,
          region: isRegionalSupervisor(req.user) ? req.user?.region : null,
        };

        logger.debug("Creating supervisor-managed coach");

        const coach = await storage.createUser(coachData);
        logger.info("Supervisor-managed coach created");

        // Handle optional photo upload before sending response
        const photoFile = firstFile(files, "photo");
        if (photoFile && photoFile.size > 0) {
          logger.debug("Processing coach photo upload");
          try {
            const photoUrl = (await saveImage(photoFile)).url;

            const updatedCoach = await storage.updateUserProfile(coach.id, { photoUrl });
            logger.info("Coach photo updated");

            // Clean up temp file
            try {
              await fs.unlink(photoFile.filepath);
              logger.debug("Temporary upload cleaned up");
            } catch (cleanupError) {
              logger.warn("Temporary upload cleanup failed");
            }

            // Return updated coach with photo URL
            logger.info("Supervisor coach creation completed");
            return res.status(201).json(updatedCoach);
          } catch (photoError) {
            logger.warn("Coach photo processing failed");
            // Photo processing failed, but coach was created successfully
          }
        } else {
          logger.debug("Coach created without photo");
        }

        // Return coach (with or without photo, depending on upload success)
        logger.info("Supervisor coach creation completed");
        return res.status(201).json(coach);
      } catch (error) {
        logger.error("Supervisor coach creation failed");
        return res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to create coach"
        });
      }
    });

    // Supervisor coach update endpoint
    app.patch("/api/supervisor/coaches/:id", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const targetCoach = await storage.getUserById(id);
        if (!targetCoach) {
          return res.status(404).json({ message: "Coach not found" });
        }
        if (!canManageTargetRegion(req, res, targetCoach.region)) {
          return;
        }
        logger.debug("Managed coach update started");

        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

        const updates: Partial<User> = {};

        if (fields.firstName?.[0]) updates.firstName = fields.firstName[0];
        if (fields.lastName?.[0]) updates.lastName = fields.lastName[0];
        if (fields.email?.[0]) updates.email = fields.email[0];
        if (fields.school?.[0]) updates.school = fields.school[0];
        if (isAdministrator(req.user) && fields.region?.[0]) {
          updates.region = fields.region[0];
        }

        if (fields.yearsCoaching?.[0]) {
          const yearsCoaching = parseInt(fields.yearsCoaching[0], 10);
          if (!isNaN(yearsCoaching)) updates.yearsCoaching = yearsCoaching;
        }

        if (files.photo) {
          const photo = firstFile(files, "photo");
          if (photo && photo.size > 0) {
            try {
              updates.photoUrl = (await saveImage(photo)).url;
            } catch (error) {
              if (error instanceof UploadError) return res.status(error.statusCode).json({ message: error.message });
              logger.error("Managed coach photo processing failed");
              return res.status(500).json({ message: "Error processing uploaded photo" });
            }
          }
        }

        logger.debug("Updating coach profile");
        const updatedCoach = await storage.updateUserProfile(id, updates, true);
        res.json(updatedCoach);
      } catch (error) {
        logger.error("Managed coach update failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to update coach"
        });
      }
    });

    // Supervisor coach delete endpoint
    app.delete("/api/supervisor/coaches/:id", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const targetCoach = await storage.getUserById(id);
        if (!targetCoach) {
          return res.status(404).json({ message: "Coach not found" });
        }
        if (!canManageTargetRegion(req, res, targetCoach.region)) {
          return;
        }
        logger.debug("Managed coach deletion started");
        await storage.deleteUser(id);
        res.json({ message: "Coach deleted successfully" });
      } catch (error) {
        logger.error("Managed coach deletion failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to delete coach"
        });
      }
    });

    // Update a coach (admin endpoint)
    app.patch("/api/admin/coaches/:id", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const targetCoach = await storage.getUserById(id);
        if (!targetCoach) {
          return res.status(404).json({ message: "Coach not found" });
        }
        if (!canManageTargetRegion(req, res, targetCoach.region)) {
          return;
        }
        logger.debug("Managed coach update started");

        const uploadsDir = path.join(process.cwd(), "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });

        const { fields, files } = await parseImageMultipart(req, 10 * 1024 * 1024);

        // Create updates object
        const updates: Partial<User> = {};

        if (fields.firstName?.[0]) updates.firstName = fields.firstName[0];
        if (fields.lastName?.[0]) updates.lastName = fields.lastName[0];
        if (fields.email?.[0]) updates.email = fields.email[0];
        if (fields.school?.[0]) updates.school = fields.school[0];

        if (fields.yearsCoaching?.[0]) {
          const yearsCoaching = parseInt(fields.yearsCoaching[0], 10);
          if (!isNaN(yearsCoaching)) updates.yearsCoaching = yearsCoaching;
        }

        // Handle photo upload
        if (files.photo) {
          const photo = firstFile(files, "photo");
          if (photo && photo.size > 0) {
            try {
              updates.photoUrl = (await saveImage(photo)).url;
            } catch (error) {
              if (error instanceof UploadError) return res.status(error.statusCode).json({ message: error.message });
              logger.error("Managed coach photo processing failed");
              return res.status(500).json({ message: "Error processing uploaded photo" });
            }
          }
        }

        logger.debug("Updating coach profile");
        const updatedCoach = await storage.updateUserProfile(id, updates, true);
        res.json(updatedCoach);
      } catch (error) {
        logger.error("Managed coach update failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to update coach"
        });
      }
    });

    // Delete a coach (admin endpoint)
    app.delete("/api/admin/coaches/:id", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const targetCoach = await storage.getUserById(id);
        if (!targetCoach) {
          return res.status(404).json({ message: "Coach not found" });
        }
        if (!canManageTargetRegion(req, res, targetCoach.region)) {
          return;
        }

        logger.debug("Managed coach deletion started");

        await storage.deleteUser(id);
        res.json({ message: "Coach deleted successfully" });
      } catch (error) {
        logger.error("Managed coach deletion failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to delete coach"
        });
      }
    });

    // Get all teams
    app.get("/api/teams", async (req, res) => {
      try {
        const teams = await storage.getTeams();
        res.json(teams);
      } catch (error) {
        logger.error("Teams fetch failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to fetch teams"
        });
      }
    });

    // Official.association and User.region are the normalized jurisdiction
    // boundary. Teams created by supervisors always inherit that boundary.
    app.post("/api/teams", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const parsedTeam = insertTeamSchema.parse(req.body);
        const requestedRegion = normalizeRegion(parsedTeam.region);
        if (!isAdministrator(req.user) && !canManageRegion(req.user, req.user?.region)) {
          return res.status(403).json({ message: "Forbidden for this region" });
        }
        const teamData = {
          ...parsedTeam,
          region: isAdministrator(req.user) ? requestedRegion : normalizeRegion(req.user!.region),
        };
        if (!isAdministrator(req.user) && !canManageRegion(req.user, teamData.region)) {
          return res.status(403).json({ message: "Forbidden for this region" });
        }
        
        // Check if team already exists to prevent duplicates
        const existingTeams = await storage.getTeams();
        const teamExists = existingTeams.some(team =>
          team.name.toLowerCase() === teamData.name.toLowerCase()
        );
        
        if (teamExists) {
          return res.status(400).json({ message: "A team with this name already exists" });
        }
        
        const team = await storage.createTeam(teamData);
        res.status(201).json(team);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ message: "Invalid team data", errors: error.errors });
        }
        logger.error("Team creation failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to create team"
        });
      }
    });

    // Update a team
    app.patch("/api/teams/:id", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const existingTeam = await storage.getTeamById(id);
        if (!existingTeam) {
          return res.status(404).json({ message: "Team not found" });
        }
        if (!canManageTargetRegion(req, res, existingTeam.region)) {
          return;
        }
        const teamData = insertTeamSchema.parse(req.body);
        if (!canManageTargetRegion(req, res, teamData.region)) {
          return;
        }
        const team = await storage.updateTeam(id, teamData);
        res.json(team);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ message: "Invalid team data", errors: error.errors });
        }
        logger.error("Team update failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to update team"
        });
      }
    });

    // Delete a team
    app.delete("/api/teams/:id", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const existingTeam = await storage.getTeamById(id);
        if (!existingTeam) {
          return res.status(404).json({ message: "Team not found" });
        }
        if (!canManageTargetRegion(req, res, existingTeam.region)) {
          return;
        }
        await storage.deleteTeam(id);
        res.json({ message: "Team deleted successfully" });
      } catch (error) {
        logger.error("Team deletion failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to delete team"
        });
      }
    });

    // Debug endpoint to check event-team associations
    if (debugRoutesEnabled(isProduction)) {
      app.get("/api/debug/event-teams", isAuthenticated, isAdmin, async (req, res) => {
      try {
        const { pool } = await import('./db');
        const client = await pool.connect();
        
        // Get all event_teams records
        const eventTeamsResult = await client.query('SELECT * FROM event_teams ORDER BY event_id');
        
        // Get all teams
        const teamsResult = await client.query('SELECT * FROM teams ORDER BY id');
        
        // Get all events
        const eventsResult = await client.query('SELECT id, name FROM events ORDER BY id');
        
        client.release();
        
        res.json({
          event_teams: eventTeamsResult.rows,
          teams: teamsResult.rows,
          events: eventsResult.rows,
          summary: {
            total_event_teams: eventTeamsResult.rows.length,
            total_teams: teamsResult.rows.length,
            total_events: eventsResult.rows.length
          }
        });
      } catch (error) {
        console.error("Error fetching debug data:", error);
        res.status(500).json({ message: "Error fetching debug data" });
      }
      });
    }

    // Settings API endpoints removed - feature discontinued

    // Change password endpoint
    app.post("/api/users/change-password", isAuthenticated, async (req, res) => {
      try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
          return res.status(400).json({ message: "Current password and new password are required" });
        }

        if (newPassword.length < 8) {
          return res.status(400).json({ message: "New password must be at least 8 characters long" });
        }

        // Verify current password
        const user = await storage.getUserById(req.user!.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
          return res.status(401).json({ message: "Current password is incorrect" });
        }

        // Hash new password and update
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await storage.updateUserPassword(req.user!.id, hashedPassword);

        res.json({ message: "Password changed successfully" });
      } catch (error) {
        console.error("Error changing password:", error);
        res.status(500).json({ message: "Failed to change password" });
      }
    });

    // Delete event endpoint
    app.delete("/api/events/:id", isAuthenticated, isAdminOrSupervisor, async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        logger.debug("Event deletion started");

        if (isNaN(id)) {
          logger.warn("Invalid event deletion target");
          return res.status(400).json({ message: "Invalid event ID" });
        }

        // Check if event exists
        const event = await storage.getEventById(id);
        if (!event) {
          logger.warn("Event deletion target not found");
          return res.status(404).json({ message: "Event not found" });
        }
        if (!canManageTargetRegion(req, res, event.region)) {
          return;
        }

        logger.debug("Deleting event");

        // Delete the event
        await storage.deleteEvent(id);
        logger.info("Event deleted");

        res.json({ 
          message: "Event deleted successfully",
          deletedEventId: id,
          deletedEventName: event.name
        });
      } catch (error) {
        logger.error("Event deletion failed");
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to delete event"
        });
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

    // Admin: Manage Events
    app.get("/api/admin/events", isAuthenticated, isVerified, async (req, res) => {
      try {
        const events = await storage.getEvents();
        res.json(events);
      } catch (error) {
        logger.error("Admin events fetch failed");
        res.status(500).json({ message: "Failed to fetch events" });
      }
    });

    const httpServer = createServer(app);
    return httpServer;
  } catch (error) {
    console.error('Error in registerRoutes:', error);
    throw error;
  }
}