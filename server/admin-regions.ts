import type { Express } from "express";
import { z } from "zod";
import { isAdmin, isAuthenticated } from "./auth/middleware";
import type { IStorage } from "./storage";
import { logger } from "./logger";

const regionInput = z.object({
  region: z.string().trim().min(1).max(120),
}).strict();

/**
 * Region repair is deliberately separate from managed profile saves:
 * assigning jurisdiction must not approve an account or notification identity.
 */
export function registerAdminRegionRoutes(app: Express, storage: Pick<IStorage,
  "getUserById" | "updateUserProfile" | "getTeamById" | "updateTeam">) {
  for (const resource of ["coaches", "teams"] as const) {
    app.patch(`/api/admin/${resource}/:id/region`, isAuthenticated, isAdmin, async (req, res) => {
      const id = Number(req.params.id);
      const input = regionInput.safeParse(req.body);
      if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id) || !input.success) {
        return res.status(400).json({ message: "A valid ID and explicit region (1–120 characters) are required" });
      }
      try {
        if (resource === "coaches") {
          const coach = await storage.getUserById(id);
          if (!coach || coach.userType !== "Coach") {
            return res.status(404).json({ message: "Coach not found" });
          }
          // false retains account approval but never grants notification approval.
          // A changed region invalidates any old identity via the existing service.
          const updated = await storage.updateUserProfile(id, { region: input.data.region }, false);
          return res.json({ id: updated.id, region: updated.region });
        }
        const team = await storage.getTeamById(id);
        if (!team) return res.status(404).json({ message: "Team not found" });
        const updated = await storage.updateTeam(id, { region: input.data.region });
        return res.json({ id: updated.id, region: updated.region });
      } catch {
        logger.error("Administrator region assignment failed");
        return res.status(500).json({ message: "Unable to assign region" });
      }
    });
  }
}
