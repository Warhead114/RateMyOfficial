import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canManageRegion,
  filterToAuthorizedRegion,
} from "../server/services/permissions";
import {
  debugRoutesEnabled,
  requireSessionSecret,
  sessionCookieOptions,
} from "../server/session-config";

const admin = { role: "admin", userType: "Coach", region: null };
const eastSupervisor = {
  role: "user",
  userType: "Regional Supervisor",
  region: "East",
  isVerified: true,
};

test("administrators retain unrestricted regional authority", () => {
  assert.equal(canManageRegion(admin, null), true);
  assert.equal(canManageRegion(admin, "West"), true);
});

test("supervisors are limited to a normalized matching region", () => {
  assert.equal(canManageRegion(eastSupervisor, " east "), true);
  assert.equal(canManageRegion(eastSupervisor, "West"), false);
  assert.equal(canManageRegion(eastSupervisor, null), false);
  assert.equal(
    canManageRegion({ ...eastSupervisor, region: null }, "East"),
    false,
  );
});

test("pending regional supervisors have no regional authority", () => {
  assert.equal(
    canManageRegion({ ...eastSupervisor, isVerified: false }, "East"),
    false,
  );
});

test("regional list filtering denies unassigned and cross-region records", () => {
  assert.deepEqual(
    filterToAuthorizedRegion(eastSupervisor, [
      { id: 1, region: "East" },
      { id: 2, region: "West" },
      { id: 3, region: null },
    ]),
    [{ id: 1, region: "East" }],
  );
});

test("normalized association/region jurisdiction denies outside and missing targets", () => {
  const matchingOfficial = { association: " EAST " };
  const outsideOfficial = { association: "West" };
  const unassignedTeam = { region: null };
  assert.equal(canManageRegion(eastSupervisor, matchingOfficial.association), true);
  assert.equal(canManageRegion(eastSupervisor, outsideOfficial.association), false);
  assert.equal(canManageRegion(eastSupervisor, unassignedTeam.region), false);
  assert.equal(canManageRegion(admin, outsideOfficial.association), true);
});

test("prepared orphan archive and delete scripts separate archival from approved deletion", async () => {
  const archiveScript = await readFile(
    "migrations/20260830_archive_orphan_reviews_prepared.sql",
    "utf8",
  );
  const deleteScript = await readFile(
    "migrations/20260830_delete_orphan_reviews_prepared.sql",
    "utf8",
  );
  assert.match(archiveScript, /WHERE r\.id IN \(9, 10\)/);
  assert.doesNotMatch(archiveScript, /DELETE FROM reviews/);
  assert.match(deleteScript, /operator_approved BOOLEAN := false/);
  assert.match(deleteScript, /a\.review_row = to_jsonb\(r\)/);
  assert.match(deleteScript, /DELETE FROM reviews WHERE id IN \(9, 10\)/);
  assert.match(deleteScript, /RAISE EXCEPTION 'Default safety abort/);
});

test("session configuration has no fallback secret", () => {
  assert.throws(() => requireSessionSecret(undefined), /SESSION_SECRET/);
  assert.equal(requireSessionSecret("configured"), "configured");
});

test("production sessions require secure HTTP-only same-site cookies", () => {
  assert.deepEqual(sessionCookieOptions(true), {
    secure: true,
    maxAge: 86_400_000,
    sameSite: "lax",
    httpOnly: true,
  });
  assert.equal(sessionCookieOptions(false).secure, false);
});

test("debug routes are disabled in production", () => {
  assert.equal(debugRoutesEnabled(true), false);
  assert.equal(debugRoutesEnabled(false), true);
});