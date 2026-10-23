import { Strategy as LocalStrategy } from "passport-local";
import { storage } from "../storage";
import bcrypt from "bcryptjs";
import type { User } from "@shared/schema";

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      userType: string;
      school: string | null;
      yearsCoaching: number | null;
      region: string | null;
      yearsExperience: number | null;
      photoUrl: string | null;
      isVerified: boolean;
      sessionVersion: number;
    }
  }
}

export function configurePassport(passport: import("passport").PassportStatic) {
  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Incorrect email or password" });
          }

          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) {
            return done(null, false, { message: "Incorrect email or password" });
          }

          return done(null, {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            userType: user.userType,
            school: user.school,
            yearsCoaching: user.yearsCoaching,
            region: user.region,
            yearsExperience: user.yearsExperience,
            photoUrl: user.photoUrl,
            isVerified: user.isVerified || false,
            sessionVersion: user.sessionVersion,
          });
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, {
      id: user.id,
      sessionVersion: user.sessionVersion,
    });
  });

  passport.deserializeUser(async (
    serialized: number | { id: number; sessionVersion?: number },
    done,
  ) => {
    try {
      const id = typeof serialized === "number" ? serialized : serialized.id;
      const sessionVersion =
        typeof serialized === "number" ? 0 : serialized.sessionVersion ?? 0;
      const user = await storage.getUserById(id);
      if (!user || user.sessionVersion !== sessionVersion) {
        return done(null, false);
      }
      done(null, {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        userType: user.userType,
        school: user.school,
        yearsCoaching: user.yearsCoaching,
        region: user.region,
        yearsExperience: user.yearsExperience,
        photoUrl: user.photoUrl,
        isVerified: user.isVerified || false,
        sessionVersion: user.sessionVersion,
      });
    } catch (err) {
      done(err);
    }
  });
}